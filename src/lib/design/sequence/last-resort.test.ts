import { describe, expect, it } from "vitest";
import { beatOf } from "./fixtures";
import { plainVersions } from "./last-resort";

describe("plainVersions", () => {
  it("splits a one-fact owner point and gives its second half a subject", () => {
    const versions = plainVersions(
      beatOf({ headline: "350ml that keeps 5 days" }),
      "Each bottle is 350ml and keeps for 5 days in the fridge",
      "carousel",
    );
    expect(versions[0].change).toEqual({
      headline: "Each bottle is 350ml",
      subheadline: "It keeps for 5 days in the fridge.",
    });
  });

  it("offers the brief's own sentence under a bare claim", () => {
    const versions = plainVersions(
      beatOf({ headline: "Doors open on 3 March" }),
      "Doors open on 3 March",
      "carousel",
      "Ledgerly launches on 3 March. Doors open on 3 March for the first 500 freelancers.",
    );
    expect(versions.map((v) => v.change.subheadline)).toContain(
      "Doors open on 3 March for the first 500 freelancers.",
    );
  });

  it("only cuts a subheadline on the hook or the action, never a middle frame", () => {
    const cut = (role: "hook" | "body") =>
      plainVersions(
        beatOf({ role, subheadline: "FreshFold." }),
        "",
        "carousel",
      ).some((v) => v.change.subheadline === "");
    expect(cut("hook")).toBe(true);
    expect(cut("body")).toBe(false);
  });
});
