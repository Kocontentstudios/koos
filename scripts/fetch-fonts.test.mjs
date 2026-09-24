// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SOURCES } from "../src/lib/design/render/fonts.ts";
import {
  downloadFace,
  FACES,
  isCurrent,
  isUsableFace,
  TTF_USER_AGENT,
  ttfUrlFrom,
} from "./fetch-fonts.mjs";

const TRUETYPE = [0x00, 0x01, 0x00, 0x00];

function faceBytes(signature = TRUETYPE, length = 8192) {
  const bytes = new Uint8Array(length);
  bytes.set(signature, 0);
  return bytes;
}

const respond = (body) => ({
  ok: true,
  status: 200,
  text: async () => body,
  arrayBuffer: async () => body.buffer ?? body,
});

const TTF_CSS = `@font-face{font-family:'Montserrat';src:url(https://fonts.gstatic.com/s/m.ttf) format('truetype');}`;

describe("ttfUrlFrom", () => {
  it("takes the TrueType src", () => {
    expect(ttfUrlFrom(TTF_CSS)).toBe("https://fonts.gstatic.com/s/m.ttf");
  });

  it("takes the OpenType src", () => {
    expect(ttfUrlFrom("src:url(https://x/f.otf) format('opentype');")).toBe(
      "https://x/f.otf",
    );
  });

  /* The failure the old User-Agent exists to prevent: a modern UA gets WOFF2,
     which satori rejects outright. Better to fail the build than write it. */
  it("ignores a WOFF2 src", () => {
    expect(
      ttfUrlFrom("src:url(https://x/f.woff2) format('woff2');"),
    ).toBeNull();
  });
});

describe("isUsableFace", () => {
  it.each([
    ["TrueType", [0x00, 0x01, 0x00, 0x00]],
    ["a 'true' TrueType", [0x74, 0x72, 0x75, 0x65]],
    ["CFF OpenType", [0x4f, 0x54, 0x54, 0x4f]],
    ["a TrueType collection", [0x74, 0x74, 0x63, 0x66]],
  ])("accepts %s", (_label, signature) => {
    expect(isUsableFace(faceBytes(signature))).toBe(true);
  });

  it.each([
    ["WOFF2", [0x77, 0x4f, 0x46, 0x32]],
    ["an HTML error page", [0x3c, 0x21, 0x44, 0x4f]],
  ])("rejects %s", (_label, signature) => {
    expect(isUsableFace(faceBytes(signature))).toBe(false);
  });

  /* A truncated download keeps the signature but is unparseable, and once it
     is on disk fonts.ts prefers it over the network fallback forever. */
  it("rejects a body too short to be a face", () => {
    expect(isUsableFace(faceBytes(TRUETYPE, 512))).toBe(false);
  });

  it("rejects an empty read", () => {
    expect(isUsableFace(new Uint8Array(0))).toBe(false);
  });
});

describe("isCurrent", () => {
  const face = { file: "body-regular.ttf", family: "Montserrat" };

  it("keeps a face cut from the family we still want", () => {
    expect(
      isCurrent(face, { "body-regular.ttf": "Montserrat" }, faceBytes()),
    ).toBe(true);
  });

  /* The drift a signature check cannot see: change the family and the old file
     is still a perfectly valid font, so every machine that already has it would
     print "cached" and render the previous typeface forever. */
  it("re-downloads when the family changed", () => {
    expect(isCurrent(face, { "body-regular.ttf": "Inter" }, faceBytes())).toBe(
      false,
    );
  });

  it("re-downloads when nothing recorded which family it is", () => {
    expect(isCurrent(face, {}, faceBytes())).toBe(false);
  });

  it("re-downloads when the recorded file is not usable", () => {
    expect(
      isCurrent(
        face,
        { "body-regular.ttf": "Montserrat" },
        faceBytes([0x77, 0x4f, 0x46, 0x32]),
      ),
    ).toBe(false);
  });
});

describe("downloadFace", () => {
  it("asks for the stylesheet with the User-Agent that yields TTF", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(TTF_CSS))
      .mockResolvedValueOnce(respond(faceBytes()));

    await downloadFace("Montserrat", fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://fonts.googleapis.com/css2?family=Montserrat");
    expect(init.headers["User-Agent"]).toBe(TTF_USER_AGENT);
  });

  it("encodes a multi-word family", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(TTF_CSS))
      .mockResolvedValueOnce(respond(faceBytes()));

    await downloadFace("Bricolage Grotesque:wght@700", fetchImpl);

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700",
    );
  });

  it("returns the face bytes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(TTF_CSS))
      .mockResolvedValueOnce(respond(faceBytes()));

    const bytes = await downloadFace("Montserrat", fetchImpl);
    expect(isUsableFace(bytes)).toBe(true);
  });

  it("throws when the stylesheet request fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(downloadFace("Montserrat", fetchImpl)).rejects.toThrow("429");
  });

  it("throws when Google offers no TrueType src", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        respond("src:url(https://x/f.woff2) format('woff2');"),
      );
    await expect(downloadFace("Montserrat", fetchImpl)).rejects.toThrow(
      "no TrueType src",
    );
  });

  it("throws when the downloaded body is not a font", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(TTF_CSS))
      .mockResolvedValueOnce(respond(faceBytes([0x77, 0x4f, 0x46, 0x32])));
    await expect(downloadFace("Montserrat", fetchImpl)).rejects.toThrow(
      "not a font",
    );
  });
});

/* The runtime reads these filenames and the prefetch writes them. A rename on
   either side without the other silently restores the runtime Google
   dependency this script exists to remove, and nothing else would notice.
   Compared by VALUE against the imported list: reading fonts.ts as text would
   let a comment shaped like a source entry shadow the real one. */
describe("FACES matches SOURCES in fonts.ts", () => {
  it("vendors exactly the files and families the renderer loads", () => {
    expect(SOURCES.map(({ file, family }) => ({ file, family }))).toEqual(
      FACES,
    );
  });
});
