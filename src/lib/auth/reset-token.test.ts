import { describe, expect, it } from "vitest";
import { generateResetToken, hashResetToken } from "./reset-token";

describe("reset token", () => {
  it("hash matches its own token deterministically", () => {
    const { token, tokenHash } = generateResetToken();
    expect(hashResetToken(token)).toBe(tokenHash);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tokens are unique and URL-safe", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
  });
});
