import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
} from "./invite-token";

describe("invite tokens", () => {
  it("TTL is exactly 7 days", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("generates a url-safe token whose sha256 hash matches", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("two tokens never collide", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });
});
