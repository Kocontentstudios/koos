import { describe, expect, it } from "vitest";
import { buildDirectionsSystemPrompt } from "@/lib/ai/prompts/design-directions";
import { type CoverKind, factStated, needsFor } from "./brief-facts";
import { buildFactWritePrompt } from "./fact-writer";

/*
 * Round 19: a time's and a price's rival is a value of its own kind, as
 * round 18 made a count's (the orchestrator applying Oluwaseyi's "of its
 * kind" ruling of 2026-10-28). Round 17 took any plain number up to 24 as
 * a rival hour, and the paid eval at cb9f951 refused masterclass-ko's
 * "Class runs 2pm to 5pm · 10 seats". A count joined to another count by
 * "or", "vs" or "/" is now refused whatever it counts ("10 seats or 12
 * desks", round-18 residual).
 */

const fact = (kind: CoverKind, text: string) => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const design = (subheadline: string) => ({
  headline: "Class",
  subheadline,
  cta: "",
  footerLines: [],
  footerStyle: "none" as const,
});

type Row = [kind: CoverKind, text: string, subheadline: string];

/* Refused before round 19 because a count, an amount's count or an
   address stood beside the time or price. */
const NOW_STATED: Row[] = [
  ["time", "2pm to 5pm", "Class runs 2pm to 5pm · 10 seats"],
  ["time", "7pm", "Doors 7pm · 12 stalls"],
  ["time", "7pm", "Doors 7pm, 2 hours of music"],
  ["time", "7pm", "Doors 7pm · Hall 2"],
  ["time", "7pm", "Book table 6, 7pm"],
  ["time", "7pm", "Doors 7pm · 12 Ozumba Mbadiwe Avenue"],
  ["time", "7pm", "Doors 7pm, or 8 guests"],
  ["time", "7pm", "Doors 7pm, 1 night only"],
  ["time", "7pm", "Doors 7pm, twelve stalls"],
  ["time", "7pm", "Doors 7pm, 2 per table"],
  ["time", "2pm to 5pm", "Class runs 2pm to 5pm, 3 sessions"],
  ["price", "₦100", "₦100 for 20 pieces"],
  ["price", "₦500", "₦500 for 60 minutes"],
  ["time", "7pm", "Ages 6 to 12, 7pm"],
  ["time", "7pm", "Doors 7pm · kids 4 and under free"],
];

/* Stated before and after: the rule must not swing back. */
const STILL_STATED: Row[] = [
  ["price", "₦6,000", "₦6,000 for 10 people"],
  ["time", "7pm", "Doors 7pm · 18+"],
  ["time", "7pm", "Doors 7pm · 5 December"],
  ["time", "7pm", "Doors 7pm · 2026"],
  ["time", "7pm", "Doors 7pm · ₦5,000"],
  ["time", "7pm", "Doors 7pm, 20% off"],
  ["time", "7pm", "Doors 7pm · 18+ · 10 seats"],
  ["quantity", "10 seats", "Class runs 2pm to 5pm · 10 seats"],
  ["quantity", "10 seats", "10 seats · 2 hours"],
  ["quantity", "10 seats", "10 seats, 1 instructor"],
  ["quantity", "10 seats", "10 seats and 2 instructors"],
  ["quantity", "10 seats", "10 seats in 2 rooms"],
  ["quantity", "only 20 pieces", "Only 20 pieces, each made by one artisan"],
];

/* Another value of the fact's kind: an hour, an amount, or a count
   offered as the fact's alternative. */
const RIVALS: Row[] = [
  ["time", "7pm", "Doors 6, or 7pm"],
  ["time", "7pm", "7pm or 8"],
  ["time", "7pm", "Doors 6 or 7pm"],
  ["time", "7pm", "Six or 7pm"],
  ["time", "7pm", "Eight or 7pm"],
  ["time", "7pm", "Doors 6-7pm"],
  ["time", "7pm", "Doors 6.30 or 7pm"],
  ["time", "7pm", "From 6 to 7pm"],
  ["time", "7pm", "Doors at 6 or at 7pm"],
  ["time", "7pm", "Doors 7pm, starts 8"],
  ["time", "7pm", "Doors 7pm (8 on Sunday)"],
  ["time", "7pm", "Doors 7pm, or 8 if it rains"],
  ["time", "7pm", "Doors 7pm, or eight"],
  ["time", "7pm", "Doors 7pm, 12 max"],
  ["time", "7pm", "Doors 7pm or 8 sharp"],
  ["time", "7pm", "Doors 7pm, last entry 9"],
  ["time", "7pm", "Doors 7pm, 8 at the latest"],
  ["time", "7pm", "Doors 7pm, 9 till late"],
  ["time", "7pm", "Doors 7pm, 8 for dinner"],
  ["time", "7pm", "Doors 7pm / 8"],
  ["time", "7pm", "Doors 7pm, closes 11"],
  ["time", "7pm", "DOORS 7PM OR 8"],
  ["time", "7pm", "Doors 7pm, kids from 6"],
  ["time", "7pm", "Doors 7pm or 8pm"],
  ["time", "7pm", "Doors 7pm or 19:30"],
  ["time", "7pm", "Doors 7pm or noon"],
  ["time", "2pm to 5pm", "Class runs 2pm to 5pm, or 3 to 6"],
  ["price", "₦6,000", "₦6,000 or 5,000"],
  ["price", "₦6,000", "₦6,000 (or 5,000)"],
  ["price", "₦6,000", "5,000 or ₦6,000"],
  ["price", "₦6,000", "₦6,000 or 5000"],
  ["price", "₦6,000", "₦6,000 or five thousand"],
  ["price", "₦6,000", "₦6,000, or 5,000 for members"],
  ["price", "₦6,000", "₦6,000, members 5,000"],
  ["price", "₦6,000", "₦6,000, 1,500 for kids"],
  ["price", "₦6,000", "₦6,000 · 5,000 off"],
  ["price", "₦6,000", "₦6,000 or 1,000 more"],
  ["price", "₦600", "₦600, or 100 for kids"],
  ["price", "₦6,000", "₦6,000 or 5k"],
  ["price", "₦6,000", "₦6,000 or 5.5k"],
  ["price", "₦4,500", "₦4,500 or 6k"],
  ["quantity", "10 seats", "10 seats or 12 seats"],
  ["quantity", "10 seats", "10 seats or 2 hours"],
];

/* An hour a place word, a code or an age word would otherwise claim,
   joined to the time as its range or its other choice. */
const JOINED_HOURS: Row[] = [
  ["time", "7pm", "Kids 6 to 7pm"],
  ["time", "7pm", "Kids 6-7pm"],
  ["time", "7pm", "Gate 6 or 7pm"],
  ["time", "7pm", "Table 6 or 7pm"],
  ["time", "7pm", "SS2 or 7pm"],
];

/* A plain number a day word follows is an hour, not a count. */
const HOURS_FOR_DAYS: Row[] = [
  ["time", "7pm", "Doors 6 Fridays, 7pm Saturdays"],
  ["time", "7pm", "Doors 7pm, 8 Fridays"],
  ["time", "7pm", "Doors 7pm, 8 Friday"],
  ["time", "7pm", "Doors 7pm (8 weekends)"],
];

/* A rate attaches no noun, so a plain number a rate follows is an
   amount. */
const PRICED_NUMBERS: Row[] = [
  ["price", "₦6,000", "₦6,000 or 5,000 a head"],
  ["price", "₦6,000", "₦6,000 or 5,000 per pair"],
];

/* The round-19 critic's fail-opens of the first draft: a tier label, an
   age word or a place word beside a second price, a session's audience
   before its hour, a place name ending in "s", a thousands amount read as
   a year. */
const CRITIC_FAIL_OPENS: Row[] = [
  ["price", "₦6,000", "Adults ₦6,000 · Kids 3,000"],
  ["price", "₦6,000", "Adults ₦6,000, children 3,000"],
  ["price", "₦6,000", "₦6,000 for adults, 3,000 kids"],
  ["price", "₦6,000", "₦6,000 regular, 4,500 students"],
  ["price", "₦6,000", "₦6,000 single · 10,000 couples"],
  ["price", "₦6,000", "₦6,000 regular / 15,000 VIPs"],
  ["price", "₦6,000", "₦6,000 weekdays, 8,000 weekends"],
  ["price", "₦6,000", "₦6,000 per head · 50,000 tables of 10"],
  ["price", "₦6,000", "Advance ₦6,000 · Gate 8,000"],
  ["price", "₦6,000", "Regular ₦6,000 · Table 100,000"],
  ["price", "₦6,000", "₦6,000 · 2,000 deposit to book"],
  ["time", "7pm", "Kids 4, adults 7pm"],
  ["time", "7pm", "Children 4 · Adults 7pm"],
  ["time", "7pm", "Doors 6 Lagos time, show 7pm"],
  ["quantity", "12 cupcakes", "12 cupcakes or choose 6 cookies"],
  ["quantity", "12 cupcakes", "12 cupcakes, or swap for 6 cookies"],
  ["quantity", "12 cupcakes", "12 cupcakes or a box of 6 cookies"],
  ["quantity", "10 seats", "10 seats or instead 12 desks"],
];

/* The second round-19 critic's fail-opens: a word ending in "s" after an
   hour or a "for" amount that names nothing counted, a code before an
   hour, an hour written "1930hrs", a count offered first. */
const CRITIC2_FAIL_OPENS: Row[] = [
  ["time", "7pm", "Dinner 7pm, dancing 9 onwards"],
  ["time", "7pm", "Owambe starts 7pm · after-party 11 upwards"],
  ["time", "7pm", "Valentine dinner 7pm, 2nd seating 9 afterwards"],
  ["time", "7pm", "Show 7pm, encore 10 thereabouts"],
  ["time", "7pm", "Doors 6 always, show 7pm"],
  ["time", "7pm", "Arrive 6 pls, show starts 7pm"],
  ["time", "7pm", "Kickoff 7pm · Afterparty 11 kicks off"],
  ["time", "7pm", "Show 7pm Lagos, 8 Jos"],
  ["time", "7pm", "Doors 6 Lagos time, show 7pm"],
  ["time", "7pm", "Class 6pm, next one 8 thanks"],
  ["time", "7pm", "Ladies 6 guys 7pm"],
  ["time", "8pm", "Party 8pm, DJ 11"],
  ["time", "8pm", "Party 8pm, MC 10"],
  ["time", "9am", "Batch A 9am · Batch B 11"],
  ["time", "7pm", "7pm show and 9 show"],
  ["time", "7pm", "7pm session, 5 session for kids"],
  ["time", "7pm", "Show 7pm or 1930hrs for latecomers"],
  [
    "price",
    "₦15,000",
    "Bridal makeup ₦15,000 · Full package for 25,000 includes gele",
  ],
  ["price", "₦3,500", "Small chops ₦3,500 · Party pack for 30,000 serves 20"],
  ["price", "₦6,000", "₦6,000 per head, couples for 10,000 gets you both in"],
  ["price", "₦6,000", "₦6,000 regular, groups for 20,000 covers 4"],
  ["quantity", "12 cupcakes", "Get 6 cookies or go for 12 cupcakes"],
  ["quantity", "12 cupcakes", "Choose 6 cookies or grab 12 cupcakes"],
  ["quantity", "12 cupcakes", "6 cookies, or a box of 12 cupcakes"],
  ["quantity", "10 seats", "10 seats, alternatively 12 desks"],
];

/* Correct copy the closed noun list and the code rule refuse, recorded
   so a change that passes them is seen: the fact writer gives the time its
   own field. */
const FAILS_CLOSED: Row[] = [
  ["time", "7pm", "Doors 7pm for JSS3"],
  ["time", "7pm", "7pm · only 5 left"],
  ["time", "9am", "Batch 5 starts 9am"],
  ["price", "₦6,000", "₦6,000 · 1,000 guests"],
];

/* Round-18 residual: a count of a noun outside every synonym group,
   offered as the fact's alternative. */
const COUNT_ALTERNATIVES: Row[] = [
  ["quantity", "10 seats", "10 seats or 12 desks"],
  ["quantity", "10 seats", "10 seats, or 12 desks"],
  ["quantity", "10 seats", "10 seats (or 12 desks)"],
  ["quantity", "10 seats", "10 seats / 12 desks"],
  ["quantity", "10 seats", "12 desks / 10 seats"],
  ["quantity", "10 seats", "10 seats vs 12 desks"],
  ["quantity", "10 seats", "10 seats versus 12 desks"],
  ["quantity", "10 seats", "10 SEATS OR 12 DESKS"],
  ["quantity", "10 seats", "10 seats left or 12 desks"],
  ["quantity", "10 seats", "10 seats or 12 new desks"],
  ["quantity", "10 seats", "10 seats or 12 standing tables"],
  ["quantity", "10 seats", "One table or 10 seats"],
];

/* A list of counts of different things is no choice between them. */
const COUNT_LISTS: Row[] = [
  ["quantity", "10 seats", "10 seats, 12 desks"],
  ["quantity", "10 seats", "10 seats · 12 desks"],
];

const stated = ([kind, text, sub]: Row) =>
  factStated(fact(kind, text), design(sub));

describe("round 19: a time's or price's rival is a value of its kind", () => {
  it.each(NOW_STATED)("now stated: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(true);
  });
  it.each(STILL_STATED)("still stated: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(true);
  });
  it.each(RIVALS)("a rival: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(false);
  });
  it.each(JOINED_HOURS)("a joined hour: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(false);
  });
  it.each(HOURS_FOR_DAYS)("an hour for days: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(false);
  });
  it.each(PRICED_NUMBERS)("a priced number: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(false);
  });
  it.each(COUNT_ALTERNATIVES)("a count alternative: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(false);
  });
  it.each(CRITIC_FAIL_OPENS)("critic fail-open: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(false);
  });
  it.each(CRITIC2_FAIL_OPENS)("critic 2 fail-open: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(false);
  });
  it.each(FAILS_CLOSED)("fails closed: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(false);
  });
  it.each(COUNT_LISTS)("a count list: %s %j in %j", (...row) => {
    expect(stated(row)).toBe(true);
  });
});

/* Round 18 told both models a time shares its field with no other small
   number; the prompts give the narrowed rule the verifier holds them to. */
describe("the prompts state the round-19 time and price rule", () => {
  const prompts = [
    ["drafting", buildDirectionsSystemPrompt({ name: "Lagos Loom" }, false)],
    [
      "fact writer",
      buildFactWritePrompt({ requests: [], briefText: "", title: "" }),
    ],
  ] as const;
  it.each(prompts)("%s prompt", (_name, prompt) => {
    expect(prompt).toContain('"Doors 6, or 7pm", "7pm or 8" state no time');
    expect(prompt).toContain('"Class runs 2pm to 5pm · 10 seats"');
    expect(prompt).toContain('"10 seats or 12 desks"');
    expect(prompt).not.toContain("no other small number");
  });
});
