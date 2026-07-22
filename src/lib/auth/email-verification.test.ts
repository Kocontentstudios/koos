import { describe, expect, it, vi } from "vitest";
import {
  generateVerificationToken,
  hashVerificationToken,
  performVerification,
  requestVerification,
} from "./email-verification";

describe("generateVerificationToken", () => {
  it("returns a token whose hash matches hashVerificationToken", () => {
    const { token, tokenHash } = generateVerificationToken();
    expect(tokenHash).toBe(hashVerificationToken(token));
    expect(token).not.toBe(tokenHash);
  });

  it("generates unique tokens", () => {
    expect(generateVerificationToken().token).not.toBe(
      generateVerificationToken().token,
    );
  });
});

describe("requestVerification", () => {
  it("stores only the hash and emails the raw token", async () => {
    const deps = {
      createEmailVerificationToken: vi.fn().mockResolvedValue(undefined),
      sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
      buildVerifyUrl: (token: string) => `https://app/verify-email/${token}`,
    };
    await requestVerification(deps, {
      id: "u1",
      firstName: "Ada",
      email: "ada@example.com",
    });

    const stored = deps.createEmailVerificationToken.mock.calls[0][0];
    const sent = deps.sendVerificationEmail.mock.calls[0][0];
    const rawToken = sent.input.verifyUrl.split("/").pop() as string;
    expect(stored.userId).toBe("u1");
    expect(stored.tokenHash).toBe(hashVerificationToken(rawToken));
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(sent.to).toBe("ada@example.com");
  });
});

function verifyDeps(
  row:
    | { id: string; userId: string; expiresAt: Date; usedAt: Date | null }
    | undefined,
) {
  return {
    getEmailVerificationTokenByHash: vi.fn().mockResolvedValue(row),
    markEmailVerificationTokenUsed: vi.fn().mockResolvedValue(undefined),
    markEmailVerified: vi.fn().mockResolvedValue(undefined),
  };
}

describe("performVerification", () => {
  const future = new Date(Date.now() + 60_000);

  it("verifies the user for a valid token", async () => {
    const deps = verifyDeps({
      id: "t1",
      userId: "u1",
      expiresAt: future,
      usedAt: null,
    });
    await expect(performVerification(deps, "raw")).resolves.toEqual({
      ok: true,
      userId: "u1",
    });
    expect(deps.getEmailVerificationTokenByHash).toHaveBeenCalledWith(
      hashVerificationToken("raw"),
    );
    expect(deps.markEmailVerificationTokenUsed).toHaveBeenCalledWith("t1");
    expect(deps.markEmailVerified).toHaveBeenCalledWith("u1");
  });

  it("burns the token before marking the user verified", async () => {
    const order: string[] = [];
    const deps = verifyDeps({
      id: "t1",
      userId: "u1",
      expiresAt: future,
      usedAt: null,
    });
    deps.markEmailVerificationTokenUsed.mockImplementation(async () => {
      order.push("burn");
    });
    deps.markEmailVerified.mockImplementation(async () => {
      order.push("verify");
    });
    await performVerification(deps, "raw");
    expect(order).toEqual(["burn", "verify"]);
  });

  it("rejects an unknown token", async () => {
    const deps = verifyDeps(undefined);
    await expect(performVerification(deps, "raw")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(deps.markEmailVerified).not.toHaveBeenCalled();
  });

  it("rejects an already-used token", async () => {
    const deps = verifyDeps({
      id: "t1",
      userId: "u1",
      expiresAt: future,
      usedAt: new Date(),
    });
    await expect(performVerification(deps, "raw")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(deps.markEmailVerified).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    const deps = verifyDeps({
      id: "t1",
      userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    });
    await expect(performVerification(deps, "raw")).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
    expect(deps.markEmailVerified).not.toHaveBeenCalled();
  });
});
