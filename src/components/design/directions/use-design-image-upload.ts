"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFileNameFor } from "@/lib/uploads/design-image-limits";
import {
  ImageNotUsableError,
  type NormalisedImage,
  normalizeImageForUpload,
} from "@/lib/uploads/normalize-image";
import { uploadToPresignedUrl } from "@/lib/uploads/put-presigned";
import { designImageProblem } from "./flow-logic";

/** Which step failed decides the recovery: a file that cannot be read needs a
 *  different file, a failed presign or PUT only needs another attempt. */
export type UploadFailedStep = "prepare" | "presign" | "upload";

export interface PickedImage {
  name: string;
  bytes: number;
  previewUrl: string;
  width: number | null;
  height: number | null;
}

export type DesignImageUpload =
  | { status: "idle"; rejection: string | null }
  | { status: "preparing"; image: PickedImage }
  | { status: "uploading"; image: PickedImage; fraction: number }
  | { status: "ready"; image: PickedImage; key: string }
  | {
      status: "error";
      image: PickedImage;
      step: UploadFailedStep;
      message: string;
    };

export interface DesignImageUploadControls {
  state: DesignImageUpload;
  select: (file: File) => void;
  retry: () => void;
  clear: () => void;
}

const IDLE: DesignImageUpload = { status: "idle", rejection: null };

interface PresignedTarget {
  url: string;
  key: string;
  /** The type the URL's signature binds; the PUT must send exactly this. */
  contentType: string;
}

async function presign(
  brandId: string,
  normalized: NormalisedImage,
): Promise<PresignedTarget> {
  const res = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      brandId,
      kind: "design-image",
      fileName: uploadFileNameFor(normalized.type),
      mimeType: normalized.type,
      sizeBytes: normalized.blob.size,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    url?: string;
    key?: string;
    contentType?: string;
    error?: string;
  };
  if (!res.ok || !body.url || !body.key) {
    throw new Error(body.error ?? "The upload could not be started.");
  }
  return {
    url: body.url,
    key: body.key,
    contentType: body.contentType ?? normalized.type,
  };
}

/**
 * Normalise, presign, PUT. Starts the moment a file is picked so that by the
 * time the user has looked at the preview the bytes are usually already
 * stored, and "Use this image" goes straight to generation.
 */
export function useDesignImageUpload(
  brandId: string,
): DesignImageUploadControls {
  const [state, setState] = useState<DesignImageUpload>(IDLE);
  /* A Remove or Replace mid-upload must not let the abandoned file's late
     result overwrite the new state. */
  const attempt = useRef(0);
  const file = useRef<File | null>(null);
  /* Kept so a retry after a failed presign or PUT does not decode and
     re-encode the image a second time. */
  const normalized = useRef<NormalisedImage | null>(null);
  const previewUrl = useRef<string | null>(null);

  const releasePreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  }, []);

  useEffect(() => releasePreview, [releasePreview]);

  const run = useCallback(
    async (image: PickedImage) => {
      const current = ++attempt.current;
      const stale = () => attempt.current !== current;
      const picked = file.current;
      if (!picked) return;

      let prepared = normalized.current;
      if (!prepared) {
        setState({ status: "preparing", image });
        try {
          prepared = await normalizeImageForUpload(picked);
        } catch (err) {
          if (stale()) return;
          setState({
            status: "error",
            image,
            step: "prepare",
            message:
              err instanceof ImageNotUsableError
                ? err.message
                : "This image could not be read. Try a different file.",
          });
          return;
        }
        if (stale()) return;
        normalized.current = prepared;
        image = { ...image, width: prepared.width, height: prepared.height };
      }

      setState({ status: "uploading", image, fraction: 0 });
      let target: PresignedTarget;
      try {
        target = await presign(brandId, prepared);
      } catch (err) {
        if (stale()) return;
        setState({
          status: "error",
          image,
          step: "presign",
          message:
            err instanceof Error
              ? err.message
              : "The upload could not be started.",
        });
        return;
      }
      if (stale()) return;

      try {
        await uploadToPresignedUrl(
          target.url,
          prepared.blob,
          (fraction) => {
            if (!stale()) setState({ status: "uploading", image, fraction });
          },
          target.contentType,
        );
      } catch {
        if (stale()) return;
        setState({
          status: "error",
          image,
          step: "upload",
          message:
            "The upload didn't finish. Check your connection and try again.",
        });
        return;
      }
      if (stale()) return;
      setState({ status: "ready", image, key: target.key });
    },
    [brandId],
  );

  const select = useCallback(
    (picked: File) => {
      const problem = designImageProblem(picked);
      if (problem) {
        attempt.current += 1;
        file.current = null;
        normalized.current = null;
        releasePreview();
        setState({ status: "idle", rejection: problem });
        return;
      }
      file.current = picked;
      normalized.current = null;
      releasePreview();
      previewUrl.current = URL.createObjectURL(picked);
      void run({
        name: picked.name,
        bytes: picked.size,
        previewUrl: previewUrl.current,
        width: null,
        height: null,
      });
    },
    [releasePreview, run],
  );

  const retry = useCallback(() => {
    if (state.status !== "error") return;
    void run(state.image);
  }, [run, state]);

  const clear = useCallback(() => {
    attempt.current += 1;
    file.current = null;
    normalized.current = null;
    releasePreview();
    setState(IDLE);
  }, [releasePreview]);

  return { state, select, retry, clear };
}
