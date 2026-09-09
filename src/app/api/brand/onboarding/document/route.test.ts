import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const addBrandAsset = vi.fn();
const checkRateLimit = vi.fn();
const getObjectBytes = vi.fn();
const generateObject = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (...a: unknown[]) => checkBrandAccess(...a),
  addBrandAsset: (d: unknown) => addBrandAsset(d),
}));
vi.mock("@/lib/rate-limit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/rate-limit")>(
      "@/lib/rate-limit",
    );
  return { ...actual, checkRateLimit: (p: unknown) => checkRateLimit(p) };
});
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (key: string) => getObjectBytes(key),
  publicUrl: (key: string) => `https://cdn.example.com/${key}`,
}));
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { brandFieldKeys } from "@/lib/ai/tools/proposals";
import { docxFixture, pdfFixture, pptxFixture } from "@/lib/documents/fixtures";
import { POST } from "./route";

const USER = "11111111-1111-1111-1111-111111111111";
const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const KEY = `brand-docs/${USER}/abc123.pdf`;

const emptyFields = Object.fromEntries(brandFieldKeys.map((k) => [k, ""]));

function call(body: Record<string, unknown> = {}) {
  return POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({
        brandId: BRAND,
        key: KEY,
        fileName: "Brand Guidelines.pdf",
        ...body,
      }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: USER, role: "user" } });
  checkBrandAccess.mockResolvedValue({ ok: true });
  addBrandAsset.mockResolvedValue({ id: "a1" });
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  getObjectBytes.mockResolvedValue(
    pdfFixture(["Okra Kitchen", "Our colour is forest green."]),
  );
  generateObject.mockResolvedValue({
    object: {
      summary: "Okra Kitchen, a Lagos meal-prep brand.",
      fields: {
        ...emptyFields,
        name: "Okra Kitchen",
        primaryColor: "forest green",
      },
    },
  });
});

describe("who may parse a document", () => {
  it("refuses an anonymous caller", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await call()).status).toBe(401);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses someone without access to the brand", async () => {
    checkBrandAccess.mockResolvedValue({ ok: false, error: "No", status: 403 });
    expect((await call()).status).toBe(403);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("rate limits, because each parse is a model call", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    expect((await call()).status).toBe(429);
    expect(generateObject).not.toHaveBeenCalled();
  });
});

/* The route reads bytes BY KEY. A caller-supplied URL would be an SSRF: the
   server fetches whatever it is pointed at. This repo has had that bug. */
describe("the key is not a URL, and not someone else's", () => {
  it("refuses a key belonging to another user", async () => {
    const res = await call({
      key: "brand-docs/22222222-2222-2222-2222-222222222222/theirs.pdf",
    });
    expect(res.status).toBe(403);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses a key outside the document prefix", async () => {
    const res = await call({ key: `reference-images/${USER}/other.pdf` });
    expect(res.status).toBe(403);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses a traversal dressed as a key", async () => {
    const res = await call({ key: `brand-docs/../../etc/passwd` });
    expect(res.status).toBe(403);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("reads exactly the key it was given", async () => {
    await call();
    expect(getObjectBytes).toHaveBeenCalledWith(KEY);
  });
});

describe("what it will read", () => {
  it.each([
    ["Guidelines.pdf", () => pdfFixture(["Okra Kitchen"])],
    ["Guidelines.docx", () => docxFixture(["Okra Kitchen"])],
    ["Deck.pptx", () => pptxFixture([["Okra Kitchen"]])],
    ["notes.txt", () => Buffer.from("Okra Kitchen", "utf8")],
  ])("parses %s", async (fileName, bytes) => {
    getObjectBytes.mockResolvedValue(bytes());
    const res = await call({ fileName, key: `brand-docs/${USER}/f.x` });
    expect(res.status).toBe(200);
    expect(generateObject).toHaveBeenCalled();
  });

  it("refuses a file type the ticket did not name", async () => {
    const res = await call({ fileName: "sheet.xlsx" });
    expect(res.status).toBe(400);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  /* The client claims a size at presign time and a client can claim anything.
     This is the real byte length. */
  it("refuses a document over the cap by its real size", async () => {
    getObjectBytes.mockResolvedValue(Buffer.alloc(26 * 1024 * 1024));
    const res = await call();
    expect(res.status).toBe(413);
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe("a document that cannot be read", () => {
  it("404s when the object is missing", async () => {
    getObjectBytes.mockRejectedValue(new Error("no such key"));
    expect((await call()).status).toBe(404);
  });

  it("422s a corrupt file, with a reason", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from("not a pdf"));
    const res = await call();
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /password-protected or damaged/i,
    );
    expect(generateObject).not.toHaveBeenCalled();
  });

  /* A scanned deck parses fine and yields nothing. An empty confirmation card
     would be the app pretending it read something. */
  it("422s a file with no text layer and names the fix", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from("   \n  ", "utf8"));
    const res = await call({ fileName: "scan.txt" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /scan or images only/i,
    );
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("never records an asset for a document it could not read", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from("not a pdf"));
    await call();
    expect(addBrandAsset).not.toHaveBeenCalled();
  });
});

describe("what comes back", () => {
  it("returns a proposal rather than writing the brand", async () => {
    const res = await call();
    const body = (await res.json()) as {
      proposal: { kind: string; data: { fields: Record<string, string> } };
    };
    expect(body.proposal.kind).toBe("brand_fields");
    expect(body.proposal.data.fields.name).toBe("Okra Kitchen");
  });

  /* Nothing may reach the brand before the user confirms — the propose-then-
     confirm model. The only write here is the asset record. */
  it("writes no brand fields", async () => {
    await call();
    expect(addBrandAsset).toHaveBeenCalledTimes(1);
    const asset = addBrandAsset.mock.calls[0][0] as { assetType: string };
    expect(asset.assetType).toBe("document");
  });

  /* "" means "the document did not say", never "clear this". */
  it("drops the fields the document did not cover", async () => {
    const res = await call();
    const body = (await res.json()) as {
      proposal: { data: { fields: Record<string, string> } };
    };
    expect(body.proposal.data.fields).not.toHaveProperty("tone");
    expect(body.proposal.data.fields).not.toHaveProperty("overview");
  });

  /* A colour is free text: "forest green" is a real answer, not a failed hex. */
  it("keeps a colour given by name", async () => {
    const res = await call();
    const body = (await res.json()) as {
      proposal: { data: { fields: Record<string, string> } };
    };
    expect(body.proposal.data.fields.primaryColor).toBe("forest green");
  });

  it("caps the model's output so it cannot truncate mid-JSON", async () => {
    await call();
    const opts = generateObject.mock.calls[0][0] as { maxOutputTokens: number };
    expect(opts.maxOutputTokens).toBeGreaterThan(0);
  });

  it("passes the conversation through to the prompt", async () => {
    await call({ conversation: "user: We are in Lagos." });
    const opts = generateObject.mock.calls[0][0] as { prompt: string };
    expect(opts.prompt).toContain("Lagos");
    expect(opts.prompt).toContain("Brand Guidelines.pdf");
  });

  /* The asset record is a nice-to-have; the extraction is what the user is
     waiting for. Losing one must not lose the other. */
  it("still returns the proposal when the asset cannot be recorded", async () => {
    addBrandAsset.mockRejectedValue(new Error("db down"));
    expect((await call()).status).toBe(200);
  });

  it("500s when the model call fails", async () => {
    generateObject.mockRejectedValue(new Error("bedrock down"));
    expect((await call()).status).toBe(500);
  });
});
