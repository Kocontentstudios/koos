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
