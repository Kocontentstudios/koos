import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
} from "./brief-facts";
import { factLedger, inventedFacts } from "./claims";

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const copy = (
  headline: string,
  subheadline = "",
  footerLines: string[] = [],
) => ({
  headline,
  subheadline,
  cta: "",
  footerLines,
});

const BAKERY =
  "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.";
const WEEKLY =
  "Fresh sourdough every Monday at our Yaba shop. Pickup from 7am, ₦3,000 a loaf.";

/* Round-9 live critic, bakery s1: "available from Monday" drawn as "ready
   for pickup from 7am every Monday" was scored as stated. */
describe("round 22, finding 1: a start day is never a recurrence", () => {
  const s1 = copy(
    "Worth the early start",
    "Strawberry mille-feuille ready for pickup from 7am every Monday, at ₦4,500 a slice.",
  );

  it("does not count 'every Monday' as 'available from Monday'", () => {
    expect(factStated(fact("day", "available from Monday"), s1)).toBe(false);
    expect(factStated(fact("day", "from Monday"), copy("Mondays only"))).toBe(
      false,
    );
    expect(
      factStated(fact("day", "from Monday"), copy("H", "On Mondays from 7am")),
    ).toBe(false);
    expect(
      factStated(fact("day", "from Monday"), copy("H", "Each Monday, 7am")),
    ).toBe(false);
  });

  it("still counts a start or a plain day", () => {
    for (const said of [
      "Available from Monday",
      "Monday onwards",
      "Starting Monday",
      "Out Monday",
    ]) {
      expect(
        factStated(fact("day", "available from Monday"), copy("H", said)),
      ).toBe(true);
    }
  });

  it("refuses 'every Monday' when the brief only starts on Monday", () => {
    const ledger = factLedger([BAKERY]);
    expect(inventedFacts(s1.subheadline, ledger)).toEqual(["every Monday"]);
    expect(inventedFacts("Pickup on Mondays", ledger)).toEqual(["Mondays"]);
    expect(inventedFacts("Available from Monday", ledger)).toEqual([]);
  });

  /* The mirror: the brief's recurrence is not a start. */
  it("does not count 'from Monday' as 'every Monday'", () => {
    expect(
      factStated(
        fact("day", "every Monday"),
        copy("H", "", ["Sourdough from Monday"]),
      ),
    ).toBe(false);
    expect(
      factStated(fact("day", "every Monday"), copy("H", "Starting Monday")),
    ).toBe(false);
    expect(
      factStated(fact("day", "every Monday"), copy("H", "Mondays, from 7am")),
    ).toBe(true);
    expect(factStated(fact("day", "every Monday"), copy("Every Monday"))).toBe(
      true,
    );
  });

  it("refuses 'from Monday' when the brief's Monday only recurs", () => {
    const ledger = factLedger([WEEKLY]);
    expect(inventedFacts("Sourdough from Monday", ledger)).toEqual([
      "from Monday",
    ]);
    expect(inventedFacts("Fresh every Monday", ledger)).toEqual([]);
    expect(inventedFacts("Mondays at 7am", ledger)).toEqual([]);
  });

  it("licenses a recurrence the brief states as a range, a plural or 'daily'", () => {
    expect(
      inventedFacts(
        "Every Saturday",
        factLedger(["Open Tuesday to Saturday, 11am to 6pm."]),
      ),
    ).toEqual([]);
    expect(
      inventedFacts(
        "Every Saturday",
        factLedger(["Fittings Tue – Sat, 11am to 6pm."]),
      ),
    ).toEqual([]);
    expect(
      inventedFacts(
        "Every Monday",
        factLedger(["Weekdays 8am to 6pm, Monday too."]),
      ),
    ).toEqual([]);
    expect(
      inventedFacts(
        "Every Saturday",
        factLedger(["Open daily 9am to 7pm. Saturday deals."]),
      ),
    ).toEqual(expect.not.arrayContaining(["Every Saturday"]));
  });

  it("reads a range as a range, never a start", () => {
    const ledger = factLedger(["Open Monday to Friday, 8am to 6pm."]);
    expect(inventedFacts("Open from Monday to Friday", ledger)).toEqual([]);
  });
});
