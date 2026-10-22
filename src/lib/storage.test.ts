import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_PREFIXES, storageKeyFrom } from "@/lib/storage";

const BASE = "https://cdn.example.com";
const original = process.env.R2_PUBLIC_BASE_URL;

beforeEach(() => {
  process.env.R2_PUBLIC_BASE_URL = BASE;
});

afterEach(() => {
  process.env.R2_PUBLIC_BASE_URL = original;
});

describe("storageKeyFrom", () => {
  it("returns the key for a URL in the expected prefix", () => {
    expect(
      storageKeyFrom(`${BASE}/fonts/u1/brand.ttf`, STORAGE_PREFIXES.fonts),
    ).toBe("fonts/u1/brand.ttf");
  });

  it("accepts any of several allowed prefixes", () => {
    const allowed = [STORAGE_PREFIXES.logos, STORAGE_PREFIXES.referenceImages];
    expect(storageKeyFrom(`${BASE}/logos/u1/a.png`, allowed)).toBe(
      "logos/u1/a.png",
    );
    expect(storageKeyFrom(`${BASE}/reference-images/u1/b.png`, allowed)).toBe(
      "reference-images/u1/b.png",
    );
  });

  /* The bug this helper exists to prevent: a startsWith test on the base
     passes for a host that merely begins with it. */
  it("refuses a host that only looks like ours", () => {
    for (const url of [
      "https://cdn.example.com.attacker.test/fonts/u1/x.ttf",
      "https://cdn.example.com@attacker.test/fonts/u1/x.ttf",
      "https://attacker.test/fonts/u1/x.ttf",
    ]) {
      expect(storageKeyFrom(url, STORAGE_PREFIXES.fonts)).toBeNull();
    }
  });

  it("refuses a different scheme or port on our host", () => {
    expect(
      storageKeyFrom(
        "http://cdn.example.com/fonts/u1/x.ttf",
        STORAGE_PREFIXES.fonts,
      ),
    ).toBeNull();
    expect(
      storageKeyFrom(
        "https://cdn.example.com:8443/fonts/u1/x.ttf",
        STORAGE_PREFIXES.fonts,
      ),
    ).toBeNull();
  });

  /* The other half: matching the origin alone would still let a caller name a
     key belonging to a different kind of object — delivered client artwork,
     say — and have it read. */
  it("refuses a key outside the requested prefix", () => {
    expect(
      storageKeyFrom(
        `${BASE}/deliverables/other-user/final.png`,
        STORAGE_PREFIXES.fonts,
      ),
    ).toBeNull();
    expect(
      storageKeyFrom(`${BASE}/logos/u1/a.png`, STORAGE_PREFIXES.fonts),
    ).toBeNull();
  });

  /* A prefix check on the raw path would pass "fonts%2F..%2Fdeliverables"
     and then be re-expanded by the storage client. */
  it("refuses traversal, encoded or not", () => {
    for (const url of [
      `${BASE}/fonts/../deliverables/other/final.png`,
      `${BASE}/fonts%2F..%2Fdeliverables%2Fother%2Ffinal.png`,
    ]) {
      expect(storageKeyFrom(url, STORAGE_PREFIXES.fonts)).toBeNull();
    }
  });

  /* The decoded key is what a later URL parser sees. A `%` left after one
     decode means a second decode would change the key (`%252e%252e` is `..`
     on the next read), and a malformed escape threw instead of refusing. */
  it.each([
    "logos/%252e%252e/deliverables/u1/x.zip",
    "logos/u1/%E0%A4%A.png",
    "logos/u1/a%3Fx=1.png",
    "logos/u1/a%23y.png",
    "logos/u1//x.png",
    "logos/u1/a%E2%80%AEgnp.exe",
    "logos/u1/a%E2%80%8Bb.png",
    "logos/u1/a%00.png",
    "logos/u1/a%5C..%5Cb.png",
  ])("refuses %s, which a second read would turn into another key", (path) => {
    expect(
      storageKeyFrom(`${BASE}/${path}`, STORAGE_PREFIXES.logos),
    ).toBeNull();
  });

  it("still accepts every key the upload route mints", () => {
    expect(
      storageKeyFrom(
        `${BASE}/logos/clu1x2y3z/1729500000000-a1b2c3d4e5f6.png`,
        STORAGE_PREFIXES.logos,
      ),
    ).toBe("logos/clu1x2y3z/1729500000000-a1b2c3d4e5f6.png");
  });

  /* A sibling prefix must not satisfy a prefix check by sharing its opening
     characters. */
  it("matches whole path segments, not string prefixes", () => {
    expect(
      storageKeyFrom(`${BASE}/fonts-private/u1/x.ttf`, STORAGE_PREFIXES.fonts),
    ).toBeNull();
  });

  it("returns null for nothing, nonsense, or an unset base", () => {
    expect(storageKeyFrom(null, STORAGE_PREFIXES.fonts)).toBeNull();
    expect(storageKeyFrom("", STORAGE_PREFIXES.fonts)).toBeNull();
    expect(storageKeyFrom("not-a-url", STORAGE_PREFIXES.fonts)).toBeNull();

    process.env.R2_PUBLIC_BASE_URL = undefined;
    expect(
      storageKeyFrom(`${BASE}/fonts/u1/x.ttf`, STORAGE_PREFIXES.fonts),
    ).toBeNull();
  });

  it("tolerates a trailing slash on the configured base", () => {
    process.env.R2_PUBLIC_BASE_URL = `${BASE}/`;
    expect(
      storageKeyFrom(`${BASE}/fonts/u1/x.ttf`, STORAGE_PREFIXES.fonts),
    ).toBe("fonts/u1/x.ttf");
  });
});
