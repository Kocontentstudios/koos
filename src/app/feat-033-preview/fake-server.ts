/**
 * TEMPORARY (deleted with /feat-033-preview before merge).
 *
 * An in-browser stand-in for the routes the image-directions flow calls, so
 * the REAL GenerateDesignButton, useDesignGeneration, upload hook and
 * pollGenerationJob can be clicked through with no session, no worker and no
 * storage. Installed while the harness is mounted, removed on unmount.
 */

import type { SerializedGeneration } from "@/lib/design/serialize";
import type { JobProgress, JobStage } from "@/lib/generation/poll-job";
import { IMAGE_NOT_USABLE_PREFIX } from "@/lib/uploads/design-image-limits";

export type Scenario = "ok" | "one-failed" | "unusable" | "legacy";

const PUT_PREFIX = "/__feat033/put/";

const DIRECTIONS = [
  {
    file: "direction-1.png",
    title: "Bold split product story",
    reasons: [
      "Your pastry fills the right half, so the product is the hero",
      "Brand red ground with cream type keeps contrast high",
      "Gold call to action is the one warm accent",
    ],
  },
  {
    file: "direction-2.png",
    title: "Soft editorial arch",
    reasons: [
      "Calm blush ground lets the cutout float without a frame",
      "Headline sits low, read after the product, not before",
      "A different rhythm from direction 1: centred, not split",
    ],
  },
  {
    file: "direction-3.png",
    title: "Forest stage, product first",
    reasons: [
      "The product owns the top half on a quiet cream stage",
      "Deep green band carries the headline with no competition",
      "A third layout, so it is never a twin of the card beside it",
    ],
  },
];

export function fixtureGeneration(
  n: number,
  overrides: Partial<SerializedGeneration> = {},
): SerializedGeneration {
  const d = DIRECTIONS[n % DIRECTIONS.length];
  return {
    id: `fx-${n}`,
    url: `/feat-033-preview/${d.file}`,
    renderer: "composite",
    provider: "composite",
    model: "satori",
    status: "succeeded",
    error: null,
    width: 1080,
    height: 1350,
    designType: "Instagram post",
    briefId: null,
    calendarItemId: null,
    headline: "Make today a little sweeter",
    createdAt: "2026-10-21T08:00:00.000Z",
    direction: { title: d.title, reasons: d.reasons },
    imageSource: "upload",
    editable: true,
    ...overrides,
  };
}

interface Job {
  polls: number;
  steps: JobProgress[];
  ids: string[];
  error: string | null;
}

function stepsFor(source: "upload" | "ko", count: number): JobProgress[] {
  const at = (stage: JobStage, label: string, done = 0): JobProgress => ({
    stage,
    label,
    done,
    total: count,
  });
  return [
    at("brief", "Writing the directions…"),
    ...(source === "ko"
      ? [at("imagery", "Creating imagery…")]
      : ([] as JobProgress[])),
    at("render", "Rendering designs…", 0),
    at("render", "Rendering designs…", Math.max(1, count - 1)),
    at("checks", "Running brand checks…", count),
  ];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installFakeServer(getScenario: () => Scenario): () => void {
  const realFetch = window.fetch;
  const RealXHR = window.XMLHttpRequest;
  const jobs = new Map<string, Job>();
  const rows = new Map<string, SerializedGeneration>();
  let next = 0;
  let jobSeq = 0;

  function makeRows(source: "upload" | "ko", count: number): string[] {
    const scenario = getScenario();
    return Array.from({ length: count }, (_, i) => {
      const n = next++;
      const failed = scenario === "one-failed" && count === 2 && i === 1;
      const row = fixtureGeneration(n, {
        imageSource: source,
        status: failed ? "failed" : "succeeded",
        ...(scenario === "legacy"
          ? { direction: null, imageSource: null, editable: false }
          : {}),
      });
      rows.set(row.id, row);
      return row.id;
    });
  }

  async function handle(url: URL, init?: RequestInit): Promise<Response> {
    const { pathname } = url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (pathname === "/api/design/generate" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        image?: { source: "upload" | "ko" };
        regenerateOf?: string;
      };
      const source = body.image?.source ?? "ko";
      const count = body.regenerateOf ? 1 : 2;
      const id = `job-${++jobSeq}`;
      const unusable = getScenario() === "unusable" && source === "upload";
      jobs.set(id, {
        polls: 0,
        steps: stepsFor(source, count),
        ids: unusable ? [] : makeRows(source, count),
        error: unusable
          ? `${IMAGE_NOT_USABLE_PREFIX}: it could not be read and may be damaged. Choose another image.`
          : null,
      });
      return json({ jobId: id }, 202);
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return json({ error: "Job not found" }, 404);
      const i = job.polls++;
      if (job.error && i >= 1) {
        return json({ status: "failed", result: null, error: job.error });
      }
      if (i < job.steps.length) {
        return json({
          status: "running",
          result: null,
          error: null,
          progress: job.steps[i],
        });
      }
      return json({
        status: "succeeded",
        result: { generationIds: job.ids, failed: [] },
        error: null,
      });
    }

    if (pathname === "/api/design/generations" && method === "GET") {
      const ids = (url.searchParams.get("ids") ?? "").split(",");
      return json({
        generations: ids.flatMap((id) => {
          const row = rows.get(id);
          return row ? [row] : [];
        }),
      });
    }

    const download = pathname.match(
      /^\/api\/design\/generations\/([^/]+)\/download$/,
    );
    if (download) {
      const row = rows.get(download[1]);
      if (!row?.url) return json({ error: "Not found" }, 404);
      return realFetch(row.url);
    }

    if (pathname === "/api/uploads/presign" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        mimeType: string;
        brandId: string;
      };
      const ext = body.mimeType === "image/png" ? "png" : "jpg";
      const uuid = crypto.randomUUID();
      return json({
        url: `${PUT_PREFIX}${uuid}`,
        key: `design-images/${body.brandId}/${uuid}.${ext}`,
        contentType: body.mimeType,
      });
    }

    if (pathname === "/api/design-tickets" && method === "POST") {
      await pause(1500);
      return json({ ticket: { ticketNumber: 1042 } }, 201);
    }

    return realFetch(url, init);
  }

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return realFetch(input, init);
    return handle(url, init);
  };

  /* The upload PUT goes through XMLHttpRequest for its progress events, so a
     PUT to the fake presigned URL is answered here with simulated progress. */
  class FakeXHR extends RealXHR {
    private fakeUrl: string | null = null;

    open(method: string, url: string | URL, ...rest: unknown[]) {
      const href = String(url);
      this.fakeUrl = href.startsWith(PUT_PREFIX) ? href : null;
      if (!this.fakeUrl) {
        (RealXHR.prototype.open as (...a: unknown[]) => void).call(
          this,
          method,
          url,
          ...rest,
        );
      }
    }

    setRequestHeader(name: string, value: string) {
      if (!this.fakeUrl) super.setRequestHeader(name, value);
    }

    send(body?: Document | XMLHttpRequestBodyInit | null) {
      if (!this.fakeUrl) {
        super.send(body);
        return;
      }
      const total = body instanceof Blob ? body.size : 1;
      let step = 0;
      const tick = () => {
        step += 1;
        const loaded = Math.min(total, Math.round((total * step) / 8));
        this.upload.onprogress?.call(
          this,
          new ProgressEvent("progress", {
            lengthComputable: true,
            loaded,
            total,
          }),
        );
        if (step < 8) {
          setTimeout(tick, 220);
          return;
        }
        Object.defineProperty(this, "status", { value: 200 });
        this.onload?.(new ProgressEvent("load"));
      };
      setTimeout(tick, 220);
    }
  }
  window.XMLHttpRequest = FakeXHR;

  return () => {
    window.fetch = realFetch;
    window.XMLHttpRequest = RealXHR;
  };
}
