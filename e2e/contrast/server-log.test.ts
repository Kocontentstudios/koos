// @vitest-environment node
import { describe, expect, it } from "vitest";
import { restartedIn, serverErrors } from "./server-log";

/* Round 3's /brand crash as the dev server logged it. The browser showed only
   "Something went wrong"; this is the one place the cause appeared. */
const ROUND_3 = `
 GET /login 200 in 1116ms (next.js: 972ms, proxy.ts: 4ms, application-code: 139ms)
⨯ Error: Event handlers cannot be passed to Client Component props.
  <... data-slot="button" onClick={function swallowWhileLoading} children=...>
If you need interactivity, consider converting part of this to a Client Component.
`;

describe("serverErrors", () => {
  it("finds round 3's RSC boundary crash", () => {
    const found = serverErrors(ROUND_3);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Event handlers cannot be passed");
    expect(found[0]).toContain("swallowWhileLoading");
  });

  it("finds any error Next marks with ⨯", () => {
    expect(
      serverErrors("⨯ TypeError: Cannot read properties of undefined"),
    ).toHaveLength(1);
    expect(
      serverErrors("⨯ Error: aborted while saving the brand"),
    ).toHaveLength(1);
  });

  it("leaves the browser's forwarded console to the browser check", () => {
    expect(
      serverErrors(
        "[browser] ⨯ unhandledRejection: Error: refused by the contrast probe",
      ),
    ).toEqual([]);
  });

  it("ignores only the client going away mid-response", () => {
    expect(
      serverErrors(
        [
          "⨯ Error: The destination stream errored while writing data.",
          "⨯ [Error: aborted]",
          "⨯ Error: read ECONNRESET",
          " GET /dashboard 200 in 157ms",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

/* Round 4's lane, as next dev actually wrote it: in colour, because
   Playwright starts the web server with FORCE_COLOR=1. Copied byte for byte
   from the critic's logs (lane-full1/server.log, lane-full2/server.log and
   break/server.log under /tmp/feat-033/critique/ds-primary-r4/critic/). The
   plain-text fixtures above passed while these lines failed four clean
   routes, so both forms are pinned. */
const COLOURED_CLIENT_WENT_AWAY = [
  " GET /dashboard \u001b[32m200\u001b[39m in 163ms\u001b[2m (next.js: 15ms, proxy.ts: 17ms, application-code: 131ms)\u001b[22m",
  "\u001b[31m\u001b[1m⨯\u001b[22m\u001b[39m Error: The destination stream errored while writing data.",
  "    at \u001b[3mignore-listed frames\u001b[23m {",
].join("\n");

const COLOURED_BROWSER_LINES = [
  "\u001b[36m[browser]\u001b[39m \u001b[31m⨯ unhandledRejection: Error: refused by the contrast probe\u001b[39m",
  " GET /brand/onboarding \u001b[32m200\u001b[39m in 96ms\u001b[2m (next.js: 1.8ms, proxy.ts: 4ms, application-code: 90ms)\u001b[22m",
  "\u001b[36m[browser]\u001b[39m \u001b[31mUncaught Error: refused by the contrast probe\u001b[39m",
  "\u001b[36m[browser]\u001b[39m \u001b[31mError: refused by the contrast probe\u001b[39m \u001b[2m(src/app/global-error.tsx:13:13)\u001b[22m",
  "\u001b[36m[browser]\u001b[39m A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:",
].join("\n");

const COLOURED_RSC_CRASH = [
  "\u001b[31m\u001b[1m⨯\u001b[22m\u001b[39m Error: Event handlers cannot be passed to Client Component props.",
  '  <... data-slot="button" data-loading=... aria-busy=... loading=... disabled=... className=... onClick={function trackClick} children=...>',
].join("\n");

describe("serverErrors on next dev's coloured log", () => {
  it("ignores the client going away when the ⨯ is coloured", () => {
    expect(serverErrors(COLOURED_CLIENT_WENT_AWAY)).toEqual([]);
  });

  it("leaves coloured [browser] lines to the browser check", () => {
    expect(serverErrors(COLOURED_BROWSER_LINES)).toEqual([]);
  });

  it("still finds a coloured RSC crash, reported without the escapes", () => {
    const found = serverErrors(COLOURED_RSC_CRASH);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^⨯ Error: Event handlers cannot be passed/);
    expect(found[0]).toContain("function trackClick");
    expect(found[0]).not.toContain("\u001b");
  });

  it("finds a real error among the noise of a whole coloured run", () => {
    const found = serverErrors(
      [
        COLOURED_CLIENT_WENT_AWAY,
        COLOURED_BROWSER_LINES,
        COLOURED_RSC_CRASH,
      ].join("\n"),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Event handlers cannot be passed");
  });
});

describe("restartedIn", () => {
  it("sees next dev restarting itself and serve.mjs restarting it", () => {
    expect(
      restartedIn(
        "⚠ Server is approaching the used memory threshold, restarting...",
      ),
    ).toBe(true);
    expect(restartedIn("[serve] next dev exited (134); restart 1 of 5")).toBe(
      true,
    );
    expect(restartedIn(" GET /brand/onboarding 200 in 84ms")).toBe(false);
  });
});
