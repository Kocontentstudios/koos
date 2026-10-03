import { describe, expect, it } from "vitest";
import { type LogoVariation, orderLogoCandidates } from "./logo-variants";

const variation = (over: Partial<LogoVariation> = {}): LogoVariation => ({
  fileUrl: "https://cdn/logo.png",
  logoVariant: null,
  logoBackground: "any",
  label: null,
  isPreferred: false,
  ...over,
});

const PRIMARY = "https://cdn/primary.png";

/* loadBestLogo picks by measuring contrast and keeps the FIRST candidate when
   two tie, so this order is the tiebreak — never the decision. Measurement
   still wins whenever the marks differ, because a label is a claim and the
   probe is evidence. */
describe("orderLogoCandidates", () => {
  it("leads with the brand's primary logo when nothing else is preferred", () => {
    const other = variation({ fileUrl: "https://cdn/other.png" });

    expect(orderLogoCandidates([other], PRIMARY)).toEqual([
      PRIMARY,
      "https://cdn/other.png",
    ]);
  });

  it("offers nothing when the brand has no logo at all", () => {
    expect(orderLogoCandidates([], null)).toEqual([]);
  });

  it("still offers the variations when there is no profile logo", () => {
    const other = variation({ fileUrl: "https://cdn/other.png" });

    expect(orderLogoCandidates([other], null)).toEqual([
      "https://cdn/other.png",
    ]);
  });

  /* The whole point of letting a user choose a default: between two marks that
     both read perfectly well, theirs should win rather than whichever was
     uploaded first. */
  it("leads with the user's default, ahead of the profile logo", () => {
    const chosen = variation({
      fileUrl: "https://cdn/chosen.png",
      isPreferred: true,
    });

    expect(orderLogoCandidates([chosen], PRIMARY)[0]).toBe(
      "https://cdn/chosen.png",
    );
  });

  it("keeps the profile logo as a candidate behind the default", () => {
    const chosen = variation({
      fileUrl: "https://cdn/chosen.png",
      isPreferred: true,
    });

    expect(orderLogoCandidates([chosen], PRIMARY)).toContain(PRIMARY);
  });

  it("never offers the same file twice when the default IS the profile logo", () => {
    const chosen = variation({ fileUrl: PRIMARY, isPreferred: true });

    expect(orderLogoCandidates([chosen], PRIMARY)).toEqual([PRIMARY]);
  });

  /* A declared light/dark cut is considered artwork rather than a stray
     upload, so it is tried before an unlabelled file — but only as a tiebreak,
     and only behind the user's own choice. */
  it("tries a declared cut before an unlabelled upload", () => {
    const unlabelled = variation({ fileUrl: "https://cdn/a-unlabelled.png" });
    const forDark = variation({
      fileUrl: "https://cdn/z-on-dark.png",
      logoBackground: "dark",
    });

    expect(orderLogoCandidates([unlabelled, forDark], null)).toEqual([
      "https://cdn/z-on-dark.png",
      "https://cdn/a-unlabelled.png",
    ]);
  });

  it("is stable however the variations arrive", () => {
    const a = variation({ fileUrl: "https://cdn/a.png" });
    const b = variation({ fileUrl: "https://cdn/b.png" });

    expect(orderLogoCandidates([a, b], PRIMARY)).toEqual(
      orderLogoCandidates([b, a], PRIMARY),
    );
  });

  it("ignores a variation with no file", () => {
    const empty = variation({ fileUrl: "   " });

    expect(orderLogoCandidates([empty], PRIMARY)).toEqual([PRIMARY]);
  });
});
