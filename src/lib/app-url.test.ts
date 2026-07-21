import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl } from "@/lib/app-url";

describe("appUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses NEXT_PUBLIC_APP_URL when set, stripping a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.kocontentstudios.com/");
    expect(appUrl("/dashboard")).toBe(
      "https://app.kocontentstudios.com/dashboard",
    );
  });

  it("adds a leading slash to the path when missing", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.kocontentstudios.com");
    expect(appUrl("admin/tickets")).toBe(
      "https://app.kocontentstudios.com/admin/tickets",
    );
  });

  it("falls back to the Vercel production host when NEXT_PUBLIC_APP_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.kocontentstudios.com");
    expect(appUrl("/invite/abc")).toBe(
      "https://app.kocontentstudios.com/invite/abc",
    );
  });

  it("falls back to localhost when no env is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(appUrl("/dashboard")).toBe("http://localhost:3000/dashboard");
  });

  it("warns when the localhost fallback is used in production", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    appUrl("/dashboard");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not warn in development", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    appUrl("/dashboard");
    expect(warn).not.toHaveBeenCalled();
  });
});
