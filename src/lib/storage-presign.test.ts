// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getSignedUploadUrl } from "@/lib/storage";

/* Real presigning with fake credentials. Nothing here touches the network:
   SigV4 query signing is a local HMAC over the request. */

const ENV = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
};
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [name, value] of Object.entries(ENV)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
});

afterAll(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/* One clock for every URL in a test, so two signatures differ only because
   the request they sign differs. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T06:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function signed(contentType: string, sizeBytes: number) {
  const url = new URL(
    await getSignedUploadUrl("design-images/b/k.png", contentType, sizeBytes),
  );
  return {
    headers: url.searchParams.get("X-Amz-SignedHeaders"),
    signature: url.searchParams.get("X-Amz-Signature"),
    expires: url.searchParams.get("X-Amz-Expires"),
  };
}

describe("getSignedUploadUrl", () => {
  /* Round-1 critic B1 and B2: this read "host" alone, so the URL accepted any
     type at any size. */
  it("signs content-type and content-length as well as host", async () => {
    expect((await signed("image/png", 1234)).headers).toBe(
      "content-length;content-type;host",
    );
  });

  it("produces a different signature for a different type", async () => {
    const png = await signed("image/png", 1234);
    const html = await signed("text/html", 1234);
    expect(png.signature).not.toBe(html.signature);
    expect((await signed("image/png", 1234)).signature).toBe(png.signature);
  });

  it("produces a different signature for a different size", async () => {
    const small = await signed("image/png", 1234);
    const large = await signed("image/png", 5 * 1024 ** 3);
    expect(small.signature).not.toBe(large.signature);
  });

  it("keeps the 15 minute default lifetime", async () => {
    expect((await signed("image/png", 1)).expires).toBe("900");
  });

  /* An empty type is dropped before signing, which would quietly unbind the
     type again; a missing size cannot be bound at all. */
  it.each([
    ["an empty type", "", 10],
    ["a zero size", "image/png", 0],
    ["a negative size", "image/png", -1],
    ["a fractional size", "image/png", 1.5],
    ["an unsafe size", "image/png", Number.MAX_SAFE_INTEGER + 1],
  ])("refuses to sign %s", async (_label, contentType, sizeBytes) => {
    await expect(
      getSignedUploadUrl("design-images/b/k.png", contentType, sizeBytes),
    ).rejects.toThrow(/signed upload needs/);
  });
});
