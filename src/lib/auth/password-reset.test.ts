import { beforeEach, describe, expect, it, vi } from "vitest";
import { performReset, requestReset } from "./password-reset";
import { generateResetToken } from "./reset-token";

function requestDeps() {
  return {
    getUserByEmail: vi.fn(),
    createPasswordResetToken: vi.fn().mockResolvedValue({}),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
    buildResetUrl: (t: string) => `/reset-password?token=${t}`,
  };
}

describe("requestReset", () => {
  it("creates a token and emails a link containing the RAW token", async () => {
    const deps = requestDeps();
    deps.getUserByEmail.mockResolvedValue({
      id: "u1",
      firstName: "Sam",
      email: "sam@x.com",
    });
    await requestReset(deps, "sam@x.com");
    const stored = deps.createPasswordResetToken.mock.calls[0][0];
    const emailed = deps.sendPasswordResetEmail.mock.calls[0][0];
    expect(stored.userId).toBe("u1");
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(emailed.to).toBe("sam@x.com");
    // The link must carry the raw token, never the hash.
    expect(emailed.input.resetUrl).toContain("/reset-password?token=");
    expect(emailed.input.resetUrl).not.toContain(stored.tokenHash);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("does nothing (silently) for an unknown email", async () => {
    const deps = requestDeps();
    deps.getUserByEmail.mockResolvedValue(undefined);
    await requestReset(deps, "ghost@x.com");
    expect(deps.createPasswordResetToken).not.toHaveBeenCalled();
    expect(deps.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

function performDeps() {
  return {
    getPasswordResetTokenByHash: vi.fn(),
    updateUserPassword: vi.fn().mockResolvedValue(undefined),
    markPasswordResetTokenUsed: vi.fn().mockResolvedValue(undefined),
    invalidateUserSessions: vi.fn().mockResolvedValue(undefined),
    hashPassword: vi.fn().mockResolvedValue("argon-hash"),
  };
}

function validRow(overrides = {}) {
  return {
    id: "prt1",
    userId: "u1",
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    ...overrides,
  };
}

describe("performReset", () => {
  let deps: ReturnType<typeof performDeps>;
  beforeEach(() => {
    deps = performDeps();
  });

  it("updates the password, burns the token, kills sessions", async () => {
    const { token } = generateResetToken();
    deps.getPasswordResetTokenByHash.mockResolvedValue(validRow());
    const result = await performReset(deps, { token, password: "newpass1" });
    expect(result).toEqual({ ok: true });
    expect(deps.updateUserPassword).toHaveBeenCalledWith("u1", "argon-hash");
    expect(deps.markPasswordResetTokenUsed).toHaveBeenCalledWith("prt1");
    expect(deps.invalidateUserSessions).toHaveBeenCalledWith("u1");
    // Fail-safe order: burn the token before updating the password.
    expect(
      deps.markPasswordResetTokenUsed.mock.invocationCallOrder[0],
    ).toBeLessThan(deps.updateUserPassword.mock.invocationCallOrder[0]);
  });

  it("leaves the password unchanged when burning the token fails", async () => {
    const { token } = generateResetToken();
    deps.getPasswordResetTokenByHash.mockResolvedValue(validRow());
    deps.markPasswordResetTokenUsed.mockRejectedValue(new Error("db down"));
    await expect(
      performReset(deps, { token, password: "newpass1" }),
    ).rejects.toThrow("db down");
    expect(deps.updateUserPassword).not.toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    deps.getPasswordResetTokenByHash.mockResolvedValue(undefined);
    const result = await performReset(deps, {
      token: "zzz",
      password: "newpass1",
    });
    expect(result.ok).toBe(false);
    expect(deps.updateUserPassword).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    deps.getPasswordResetTokenByHash.mockResolvedValue(
      validRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const result = await performReset(deps, {
      token: "t",
      password: "newpass1",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an already-used token (single-use)", async () => {
    deps.getPasswordResetTokenByHash.mockResolvedValue(
      validRow({ usedAt: new Date() }),
    );
    const result = await performReset(deps, {
      token: "t",
      password: "newpass1",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a short password before touching the DB", async () => {
    const result = await performReset(deps, { token: "t", password: "abc" });
    expect(result.ok).toBe(false);
    expect(deps.getPasswordResetTokenByHash).not.toHaveBeenCalled();
  });
});
