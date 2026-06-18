import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashToken,
  SESSION_TTL_MS,
  shouldRefresh,
} from "./session-token";

describe("session token helpers", () => {
  it("generates unique, url-safe tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("hashes a token deterministically to a 64-char hex sha256", () => {
    const token = "fixed-token";
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("derives different ids for different tokens", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("flags a session for refresh once past the halfway point", () => {
    const now = 1_000_000_000_000;
    // expires in less than half the TTL → refresh
    const soon = new Date(now + SESSION_TTL_MS / 2 - 1);
    expect(shouldRefresh(soon, now)).toBe(true);
    // expires in more than half the TTL → no refresh yet
    const later = new Date(now + SESSION_TTL_MS / 2 + 10_000);
    expect(shouldRefresh(later, now)).toBe(false);
  });
});
