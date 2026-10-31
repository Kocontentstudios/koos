import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const normalize = vi.fn();
const upload = vi.fn();

/* The real error class, so a test sees the message the user would. */
vi.mock("@/lib/uploads/normalize-image", async (original) => ({
  ...(await original<typeof import("@/lib/uploads/normalize-image")>()),
  normalizeImageForUpload: (...a: unknown[]) => normalize(...a),
}));
vi.mock("@/lib/uploads/put-presigned", () => ({
  uploadToPresignedUrl: (...a: unknown[]) => upload(...a),
}));

import { ImageNotUsableError } from "@/lib/uploads/normalize-image";
import { useDesignImageUpload } from "./use-design-image-upload";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
let fetchMock: ReturnType<typeof vi.fn>;

function image(name = "cake.webp", type = "image/webp") {
  return new File(["bytes"], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  normalize.mockResolvedValue({
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    type: "image/jpeg",
    width: 2560,
    height: 1707,
  });
  upload.mockImplementation(
    async (_url: string, _file: File, onProgress: (f: number) => void) => {
      onProgress(0.5);
    },
  );
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          url: "https://r2/put",
          key: `design-images/${BRAND}/k.jpg`,
          contentType: "image/jpeg",
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

describe("useDesignImageUpload", () => {
  it("normalises, presigns as a design image and stores the key", async () => {
    const { result } = renderHook(() => useDesignImageUpload(BRAND));
    act(() => result.current.select(image()));

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    /* The re-encoded type, name and size, not the original WEBP's: the
       server signs only PNG and JPEG, and binds the size it was told. */
    expect(body).toMatchObject({
      brandId: BRAND,
      kind: "design-image",
      mimeType: "image/jpeg",
      fileName: "design-image.jpg",
      sizeBytes: 4,
    });
    /* The signature binds the presign route's contentType; the PUT must send
       exactly that, or storage answers 403. */
    const [url, sent, , contentType] = upload.mock.calls[0] as [
      string,
      Blob,
      unknown,
      string,
    ];
    expect(url).toBe("https://r2/put");
    expect(sent.size).toBe(4);
    expect(contentType).toBe("image/jpeg");
    expect(result.current.state).toMatchObject({
      status: "ready",
      key: `design-images/${BRAND}/k.jpg`,
      image: { name: "cake.webp", width: 2560, height: 1707 },
    });
  });

  /* The feat-033/upload-r2 contract: presign is told the normalised blob's
     size, and the PUT sends that same blob with the type the presign
     returned. The fixture makes each of those differ from what a careless
     client would send (the picked file's size, the blob's own type), so any
     substitution fails here rather than as a 403 from R2. */
  it("presigns the normalised blob's size and PUTs that blob with the signed type", async () => {
    const picked = new File([new Uint8Array(5000)], "huge.webp", {
      type: "image/webp",
    });
    const blob = new Blob([new Uint8Array(1234)]);
    normalize.mockResolvedValueOnce({
      blob,
      type: "image/jpeg",
      width: 2560,
      height: 1440,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          url: "https://r2/put-signed",
          key: `design-images/${BRAND}/k.jpg`,
          contentType: "image/jpeg",
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(() => useDesignImageUpload(BRAND));
    act(() => result.current.select(picked));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.sizeBytes).toBe(1234);
    expect(body.sizeBytes).not.toBe(picked.size);
    expect(upload).toHaveBeenCalledTimes(1);
    const [url, sent, , contentType] = upload.mock.calls[0];
    expect(url).toBe("https://r2/put-signed");
    expect(sent).toBe(blob);
    expect(blob.type).toBe("");
    expect(contentType).toBe("image/jpeg");
  });

  it("refuses a wrong type before any bytes move", () => {
    const { result } = renderHook(() => useDesignImageUpload(BRAND));
    act(() => result.current.select(image("scan.pdf", "application/pdf")));

    expect(result.current.state).toMatchObject({ status: "idle" });
    expect(
      result.current.state.status === "idle" && result.current.state.rejection,
    ).toMatch(/scan\.pdf/);
    expect(normalize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreadable file as a prepare failure with its message", async () => {
    normalize.mockRejectedValue(new ImageNotUsableError("undecodable"));
    const { result } = renderHook(() => useDesignImageUpload(BRAND));
    act(() => result.current.select(image()));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toMatchObject({
      step: "prepare",
      message:
        "This image can't be used: it couldn't be opened and may be damaged. Choose another image.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a failed presign without decoding the image again", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Storage is down" }), {
        status: 503,
      }),
    );
    const { result } = renderHook(() => useDesignImageUpload(BRAND));
    act(() => result.current.select(image()));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: "error",
        step: "presign",
        message: "Storage is down",
      }),
    );

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it("reports a failed PUT as an upload failure", async () => {
    upload.mockRejectedValue(new Error("Upload failed (403)"));
    const { result } = renderHook(() => useDesignImageUpload(BRAND));
    act(() => result.current.select(image()));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: "error",
        step: "upload",
      }),
    );
  });

  /* Remove while the PUT is in flight: the abandoned file finishing later
     must not bring itself back. */
  it("ignores a late result after the image was removed", async () => {
    let finish: () => void = () => {};
    upload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useDesignImageUpload(BRAND));
    act(() => result.current.select(image()));
    await waitFor(() => expect(result.current.state.status).toBe("uploading"));

    act(() => result.current.clear());
    await act(async () => finish());

    expect(result.current.state).toEqual({ status: "idle", rejection: null });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
