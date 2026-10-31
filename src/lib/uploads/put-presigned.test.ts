import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadToPresignedUrl } from "./put-presigned";

/* The presigned URL binds Content-Type and Content-Length. Whatever this
   sends for either is what storage compares against the signature. */

class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 200;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadToPresignedUrl", () => {
  it("sends the signed type when one is given, whatever file.type says", async () => {
    const file = new File(["hello"], "notes.txt", { type: "" });
    await uploadToPresignedUrl("https://put", file, () => {}, "text/plain");
    expect(FakeXhr.last.method).toBe("PUT");
    expect(FakeXhr.last.headers).toEqual({ "Content-Type": "text/plain" });
    expect(FakeXhr.last.body).toBe(file);
  });

  it("falls back to the blob's own type", async () => {
    const blob = new Blob([new Uint8Array(4)], { type: "image/png" });
    await uploadToPresignedUrl("https://put", blob, () => {});
    expect(FakeXhr.last.headers["Content-Type"]).toBe("image/png");
  });

  /* Content-Length is the browser's to set from the body; setting it by hand
     is a forbidden header that browsers ignore or reject. The body is sent
     untouched so its size is exactly the size that was signed. */
  it("never sets Content-Length itself", async () => {
    const blob = new Blob([new Uint8Array(7)], { type: "image/jpeg" });
    await uploadToPresignedUrl("https://put", blob, () => {});
    expect(Object.keys(FakeXhr.last.headers)).toEqual(["Content-Type"]);
    expect((FakeXhr.last.body as Blob).size).toBe(7);
  });

  it("rejects on a 403 from storage", async () => {
    vi.stubGlobal(
      "XMLHttpRequest",
      class extends FakeXhr {
        status = 403;
      },
    );
    await expect(
      uploadToPresignedUrl("https://put", new Blob(["x"]), () => {}),
    ).rejects.toThrow("Upload failed (403)");
  });
});
