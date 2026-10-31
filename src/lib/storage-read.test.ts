// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const send = vi.fn();

vi.mock("@aws-sdk/client-s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    send = send;
  },
}));

import { getObjectBytes, ObjectTooLargeError } from "@/lib/storage";

const ENV = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
};
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function body(length: number) {
  return { Body: { transformToByteArray: async () => new Uint8Array(length) } };
}

function sentInput(): { Bucket: string; Key: string; Range?: string } {
  return send.mock.calls[0][0].input;
}

beforeEach(() => {
  send.mockReset();
});

describe("getObjectBytes", () => {
  it("reads the whole object when no cap is given", async () => {
    send.mockResolvedValue(body(5));
    const bytes = await getObjectBytes("logos/u/a.png");
    expect(bytes.length).toBe(5);
    expect(sentInput()).toEqual({ Bucket: "bucket", Key: "logos/u/a.png" });
  });

  /* One byte past the cap is requested so "exactly at the cap" and "over it"
     are distinguishable without reading the rest of a huge object. */
  it("asks for at most the cap plus one byte", async () => {
    send.mockResolvedValue(body(10));
    await getObjectBytes("design-images/b/x.png", { maxBytes: 100 });
    expect(sentInput().Range).toBe("bytes=0-100");
  });

  it("returns an object exactly at the cap", async () => {
    send.mockResolvedValue(body(100));
    const bytes = await getObjectBytes("k", { maxBytes: 100 });
    expect(bytes.length).toBe(100);
  });

  it("throws ObjectTooLargeError past the cap", async () => {
    send.mockResolvedValue(body(101));
    await expect(getObjectBytes("k", { maxBytes: 100 })).rejects.toBeInstanceOf(
      ObjectTooLargeError,
    );
  });
});
