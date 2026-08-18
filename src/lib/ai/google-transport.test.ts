import { describe, expect, it } from "vitest";
import {
  activeGoogleTransport,
  isGoogleConfigured,
  isVertexConfigured,
} from "./google-transport";

const VERTEX = {
  GOOGLE_VERTEX_PROJECT: "koos-design",
  GOOGLE_CLIENT_EMAIL: "vercel-vertex@koos-design.iam.gserviceaccount.com",
  GOOGLE_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
};

describe("isVertexConfigured", () => {
  it("needs all three credential parts", () => {
    expect(isVertexConfigured(VERTEX)).toBe(true);
    expect(isVertexConfigured({})).toBe(false);
  });

  it("treats a partial service account as unconfigured rather than half-working", () => {
    const { GOOGLE_PRIVATE_KEY, ...missingKey } = VERTEX;
    expect(isVertexConfigured(missingKey)).toBe(false);

    const { GOOGLE_CLIENT_EMAIL, ...missingEmail } = VERTEX;
    expect(isVertexConfigured(missingEmail)).toBe(false);

    const { GOOGLE_VERTEX_PROJECT, ...missingProject } = VERTEX;
    expect(isVertexConfigured(missingProject)).toBe(false);
  });

  it("does not count the AI Studio key as Vertex credentials", () => {
    expect(isVertexConfigured({ GOOGLE_GENERATIVE_AI_API_KEY: "k" })).toBe(
      false,
    );
  });
});

describe("isGoogleConfigured", () => {
  it("accepts either credential shape", () => {
    expect(isGoogleConfigured(VERTEX)).toBe(true);
    expect(isGoogleConfigured({ GOOGLE_GENERATIVE_AI_API_KEY: "k" })).toBe(
      true,
    );
  });

  it("is false with neither", () => {
    expect(isGoogleConfigured({})).toBe(false);
  });
});

describe("activeGoogleTransport", () => {
  // Only Vertex draws the Google Cloud trial credit — AI Studio was excluded
  // for accounts opened after 2026-03-02 — so Vertex must win when both exist.
  it("prefers Vertex when both are configured", () => {
    expect(
      activeGoogleTransport({ ...VERTEX, GOOGLE_GENERATIVE_AI_API_KEY: "k" }),
    ).toBe("vertex");
  });

  it("falls back to AI Studio when only the key is present", () => {
    expect(activeGoogleTransport({ GOOGLE_GENERATIVE_AI_API_KEY: "k" })).toBe(
      "ai-studio",
    );
  });

  it("reports nothing configured rather than guessing", () => {
    expect(activeGoogleTransport({})).toBeNull();
  });
});
