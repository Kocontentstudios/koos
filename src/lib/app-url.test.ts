import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appUrl,
  appUrlBase,
  hasUnusableAppUrl,
  linkHostMismatch,
  linkHostVerdict,
  requestHost,
} from "@/lib/app-url";

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
  describe("non-production deployments", () => {
    /* NEXT_PUBLIC_APP_URL is NOT second-guessed here, even when it plainly
       holds the production URL. appUrl also builds the OAuth redirect_uri,
       which Google matches exactly, so substituting the branch host would turn
       "Continue with Google" into redirect_uri_mismatch on every preview — and
       an invitee with no account signs up through exactly that button.
       linkHostMismatch reports the misconfiguration instead. */
    it("does not substitute the branch host for a configured URL", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
      expect(appUrlBase()).toBe("https://app.koc.com");
    });

    it("reports the inherited production URL as a host mismatch", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
      expect(linkHostMismatch()).toEqual({
        resolved: "app.koc.com",
        expected: ["koos-git-staging.vercel.app"],
      });
    });

    it("is quiet when the deployment links to its own branch host", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://koos-git-staging.vercel.app");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
      expect(linkHostMismatch()).toBeNull();
    });

    it("accepts the canonical domain on the production deployment", () => {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-main.vercel.app");
      expect(linkHostMismatch()).toBeNull();
      expect(appUrlBase()).toBe("https://app.koc.com");
    });

    it("never guesses off-platform", () => {
      vi.stubEnv("VERCEL_ENV", undefined as unknown as string);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
      expect(linkHostMismatch()).toBeNull();
    });

    /* Vercel sets VERCEL_PROJECT_PRODUCTION_URL on previews too, so preferring
       it would MANUFACTURE the wrong-host bug as the default for any preview
       with no NEXT_PUBLIC_APP_URL, while a host that certainly serves this
       deployment sat unused. */
    it("does not default a preview to the production host", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "koos.app");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
      expect(appUrlBase()).toBe("https://koos-git-staging.vercel.app");
      expect(linkHostVerdict()).toBeNull();
    });

    it("falls back to the deployment host when nothing is configured", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
      vi.stubEnv("VERCEL_BRANCH_URL", "");
      vi.stubEnv("VERCEL_URL", "koos-abc123.vercel.app");
      expect(appUrlBase()).toBe("https://koos-abc123.vercel.app");
    });

    /* `vercel dev` sets VERCEL_ENV=development and VERCEL_URL to a bare
       localhost:3000, which must never be given an https:// scheme. */
    it("does not build an https localhost URL under vercel dev", () => {
      vi.stubEnv("VERCEL_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
      vi.stubEnv("VERCEL_URL", "localhost:3000");
      expect(appUrlBase()).toBe("http://localhost:3000");
    });

    it("tolerates a scheme already present on a Vercel host variable", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
      vi.stubEnv("VERCEL_BRANCH_URL", "https://x.vercel.app");
      expect(appUrlBase()).toBe("https://x.vercel.app");
    });
  });

  /* Load-bearing for OAuth, not just email: appUrl builds the redirect_uri
     that Google matches exactly, so the configured value must win. */
  it("prefers NEXT_PUBLIC_APP_URL over the Vercel production host", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "other.koc.app");
    expect(appUrlBase()).toBe("https://app.koc.com");
  });

  describe("linkHostVerdict", () => {
    /* One classification, shared by the admin panel, both invite routes and
       both scripts — they disagreed when each rolled its own. */
    it("calls the inherited production URL provably wrong", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
      expect(linkHostVerdict()?.severity).toBe("wrong");
    });

    /* A custom staging DOMAIN is never in deploymentHosts(), which only ever
       holds *.vercel.app — calling it broken would fire permanently on the
       correct configuration. */
    it("calls a custom staging domain unconfirmed, not wrong", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.koc.com");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
      expect(linkHostVerdict()?.severity).toBe("unconfirmed");
    });

    it("is silent on a correctly configured production deployment", () => {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      expect(linkHostVerdict()).toBeNull();
    });

    /* `vercel env pull` writes VERCEL_ENV=development into .env.local, so an
       ordinary laptop would otherwise be told its links point at another
       deployment — and an operator who learns to dismiss that warning misses
       the real one. linkHostMismatch exempts the same value. */
    it("does not call localhost broken under vercel dev", () => {
      vi.stubEnv("VERCEL_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "koos.app");
      expect(linkHostVerdict()).toBeNull();
    });

    it("does call localhost broken on a deployed environment", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "koos.app");
      expect(linkHostVerdict()?.severity).toBe("wrong");
    });

    /* The host a request arrived on aliases THIS deployment by construction,
       which is the one thing Vercel's env vars cannot tell us — so a custom
       staging domain stops being merely "unconfirmed". */
    it("settles an unconfirmed host against the request's own host", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.koc.com");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
      expect(linkHostVerdict()?.severity).toBe("unconfirmed");
      expect(linkHostVerdict(process.env, "staging.koc.com")).toBeNull();
    });

    /* A proxy-supplied header must not be able to silence the provable case:
       it settles what we could not otherwise confirm, nothing more. */
    it("does not let a forged host suppress the production leak", () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
      expect(
        linkHostVerdict(process.env, "koos-git-staging.vercel.app")?.severity,
      ).toBe("wrong");
    });

    it("is silent off-platform", () => {
      vi.stubEnv("VERCEL_ENV", undefined as unknown as string);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
      expect(linkHostVerdict()).toBeNull();
    });
  });

  describe("requestHost", () => {
    it("reads x-forwarded-host ahead of host, since Vercel proxies", () => {
      const req = new Request("http://internal/x", {
        headers: { host: "internal", "x-forwarded-host": "staging.koc.com" },
      });
      expect(requestHost(req)).toBe("staging.koc.com");
    });

    it("falls back to host", () => {
      const req = new Request("http://a/x", { headers: { host: "a.koc.com" } });
      expect(requestHost(req)).toBe("a.koc.com");
    });
  });

  describe("unusable NEXT_PUBLIC_APP_URL", () => {
    /* Each of these concatenates into a dead link: "https://x.com?a=1" +
       "/invite/TOKEN". A protocol check alone let three of the four past. */
    it.each([
      "app.koc.com",
      "ftp://app.koc.com",
      "not a url",
      "https://app.koc.com?x=1",
      "https://app.koc.com#frag",
      "https://app.koc.com/sub",
      "https://app.koc.com:0",
      // The WHATWG parser STRIPS these, silently yielding host "app.koc.comx".
      "https://app.koc.com\nx",
      "https://ap\tp.koc.com",
    ])("ignores %j", (value) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
      expect(appUrl("/invite/TOKEN")).toBe("https://app.koc.com/invite/TOKEN");
      expect(hasUnusableAppUrl()).toBe(true);
    });

    // Surrounding whitespace is trimmed; only EMBEDDED control chars are fatal.
    it.each([
      "https://app.koc.com",
      "https://app.koc.com/",
      "  https://app.koc.com\r\n",
    ])("accepts %j", (value) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
      expect(hasUnusableAppUrl()).toBe(false);
      expect(appUrl("/invite/TOKEN")).toBe("https://app.koc.com/invite/TOKEN");
    });
  });
});
