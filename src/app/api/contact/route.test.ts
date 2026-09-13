import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The limiter is DB-backed and its window is an hour, so an unmocked call
   writes to the real rate_limits table and the file trips itself: run the
   suite a few times inside an hour and these start 429-ing. CI never sees it
   because it has no DATABASE_URL and the limiter fails open there
   (KOOS-BUG-024). */
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: (policy: unknown) => checkRateLimit(policy),
}));

const sendMail = vi.fn();
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendMail: (o: unknown) => sendMail(o),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/contact", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const valid = { name: "Ada", email: "ada@x.com", message: "Hello there" };

describe("contact route", () => {
  beforeEach(() => {
    checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
    vi.clearAllMocks();
    sendMail.mockResolvedValue({});
    vi.stubEnv("CONTACT_EMAIL", "support@x.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends to the configured inbox with replyTo the submitter", async () => {
    const res = await POST(req(valid));
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "support@x.com", replyTo: "ada@x.com" }),
    );
  });

  it("falls back to the default inbox without CONTACT_EMAIL", async () => {
    vi.stubEnv("CONTACT_EMAIL", "");
    await POST(req(valid));
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "hello@kocontentstudios.com" }),
    );
  });

  it("400s on a bad email", async () => {
    const res = await POST(req({ ...valid, email: "nope" }));
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("400s on missing message", async () => {
    const res = await POST(req({ ...valid, message: "  " }));
    expect(res.status).toBe(400);
  });

  it("400s on oversized message", async () => {
    const res = await POST(req({ ...valid, message: "x".repeat(5001) }));
    expect(res.status).toBe(400);
  });

  it("silently accepts honeypot submissions without sending", async () => {
    const res = await POST(req({ ...valid, company: "Acme" }));
    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("500s when mail delivery fails (no fake success)", async () => {
    sendMail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(req(valid));
    expect(res.status).toBe(500);
  });

  /* Reached on purpose rather than by accident. Before this the file walked
     into its own limit after a few suite runs and the FIRST test failed, which
     reads as flake rather than as the limiter doing its job. */
  it("429s when the limiter says the caller is over", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 900 });

    const res = await POST(req(valid));

    expect(res.status).toBe(429);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("checks the limit before reading the body", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });

    // Malformed JSON would 400 if the body were parsed first.
    const res = await POST(
      new Request("http://x/api/contact", { method: "POST", body: "{" }),
    );

    expect(res.status).toBe(429);
  });
});
