import { describe, expect, it, vi } from "vitest";
import { resolveSessionRecovery } from "./session-recovery";

function deps(sessionResult: unknown) {
  return { validateSessionToken: vi.fn().mockResolvedValue(sessionResult) };
}

describe("resolveSessionRecovery", () => {
  it("redirects without clearing when no cookie is present", async () => {
    const d = deps(null);
    const result = await resolveSessionRecovery(d, {
      token: undefined,
      next: "/login",
    });
    expect(result).toEqual({ clearCookie: false, redirectTo: "/login" });
    expect(d.validateSessionToken).not.toHaveBeenCalled();
  });

  it("bounces a valid session to /dashboard without clearing", async () => {
    const result = await resolveSessionRecovery(deps({ user: { id: "u1" } }), {
      token: "live-token",
      next: "/login",
    });
    expect(result).toEqual({ clearCookie: false, redirectTo: "/dashboard" });
  });

  it("clears a dead cookie and forwards to the login target", async () => {
    const result = await resolveSessionRecovery(deps(null), {
      token: "dead-token",
      next: "/login?reset=1",
    });
    expect(result).toEqual({
      clearCookie: true,
      redirectTo: "/login?reset=1",
    });
  });

  it("falls back to /login when next is missing", async () => {
    const result = await resolveSessionRecovery(deps(null), {
      token: "dead-token",
      next: null,
    });
    expect(result.redirectTo).toBe("/login");
  });

  it("falls back to /login when next fails safeNext validation", async () => {
    for (const next of ["//evil.com", "/\\evil.com", "https://evil.com"]) {
      const result = await resolveSessionRecovery(deps(null), {
        token: "dead-token",
        next,
      });
      expect(result.redirectTo).toBe("/login");
    }
  });

  it("falls back to /login when next is not a login target", async () => {
    for (const next of ["/dashboard", "/register", "/loginx", "/login/x"]) {
      const result = await resolveSessionRecovery(deps(null), {
        token: "dead-token",
        next,
      });
      expect(result.redirectTo).toBe("/login");
    }
  });

  it("preserves a login target carrying a query string", async () => {
    const next = "/login?next=%2Finvite%2Fabc";
    const result = await resolveSessionRecovery(deps(null), {
      token: "dead-token",
      next,
    });
    expect(result).toEqual({ clearCookie: true, redirectTo: next });
  });
});
