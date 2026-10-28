import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
} from "./brief-facts";

/*
 * The holdout set for the fact verifier (round 12). The acceptance set
 * holds only the critics' probes, a fitted exam. These rows were written
 * before the round-12 fixes, from copy a designer would write for the 18
 * eval briefs (src/lib/ai/design-directions/eval/cases.ts), and labelled
 * by what a reader of the design learns, not by what the verifier did.
 *
 * `stated` is the truth. A true row the verifier refuses is a miss the
 * fact writer pays for (fail-closed); a false row it accepts ships a
 * design without the fact and counts it delivered (fail-open). They are
 * scored apart: HOLDOUT_FAIL_CLOSED names the true rows the contract
 * refuses on purpose, and no false row may ever pass.
 */

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const copy = (
  headline: string,
  subheadline = "",
  cta = "",
  footerLines: string[] = [],
) => ({ headline, subheadline, cta, footerLines });

type HoldoutRow = [
  id: string,
  kind: CoverKind,
  text: string,
  design: ReturnType<typeof copy>,
  stated: boolean,
];

export const HOLDOUT_ROWS: HoldoutRow[] = [
  /* bakery-upload, bakery-ko */
  [
    "H1",
    "price",
    "₦4,500 a slice",
    copy("Strawberry season", "Fresh mille-feuille, ₦4,500 a slice."),
    true,
  ],
  [
    "H2",
    "price",
    "₦4,500 a slice",
    copy("Strawberry season", "", "", ["N4,500 per slice · Order ahead"]),
    true,
  ],
  [
    "H3",
    "price",
    "₦4,500 a slice",
    copy("Save ₦4,500 a slice this week"),
    false,
  ],
  ["H4", "price", "₦4,500 a slice", copy("₦45,000 a box of ten"), false],
  [
    "H5",
    "time",
    "from 7am",
    copy("Mille-feuille is here", "Order ahead, pick up from 7am."),
    true,
  ],
  ["H6", "time", "from 7am", copy("Pickup from 17:00"), false],
  [
    "H7",
    "time",
    "from 7am",
    copy("Your morning slice", "", "", ["Pickup 07:00 onwards"]),
    true,
  ],
  /* textile-launch-ko, textile-launch-regenerate */
  ["H8", "date", "3 November", copy("Launching 3 November"), true],
  ["H9", "date", "3 November", copy("Top 3 November picks"), false],
  ["H10", "date", "3 November", copy("Autumn arrives November 3rd"), true],
  ["H11", "date", "3 November", copy("Launching 13 November"), false],
  [
    "H12",
    "quantity",
    "Twelve new throws and cushions",
    copy("Autumn aso-oke", "12 new throws and cushions in rust and indigo."),
    true,
  ],
  [
    "H13",
    "quantity",
    "Twelve new throws and cushions",
    copy("Autumn aso-oke", "Two new throws and cushions in rust."),
    false,
  ],
  /* valentine-box-upload */
  [
    "H14",
    "price",
    "₦25,000",
    copy("Sweet note for two", "", "Order for ₦25,000"),
    true,
  ],
  [
    "H15",
    "price",
    "₦25,000",
    copy("Six pastries, a card, 25,000 reasons to smile"),
    false,
  ],
  [
    "H16",
    "date",
    "12 February",
    copy("Dessert for two", "Pre-orders close 12 Feb."),
    true,
  ],
  [
    "H17",
    "date",
    "12 February",
    copy("Dessert for two", "Pre-orders close Feb 12th."),
    true,
  ],
  [
    "H18",
    "date",
    "12 February",
    copy("Dessert for two", "Order 12 boxes by February."),
    false,
  ],
  /* fintech-ko */
  [
    "H19",
    "quantity",
    "20 African countries",
    copy("Send money to 20 African countries"),
    true,
  ],
  [
    "H20",
    "quantity",
    "20 African countries",
    copy("Zero fees in 20 countries across Africa"),
    true,
  ],
  [
    "H21",
    "quantity",
    "20 African countries",
    copy("2,000 African customers in 20 cities"),
    false,
  ],
  /* conference-ko */
  [
    "H22",
    "date",
    "Friday 14 March",
    copy("Building for Heat", "", "", ["Friday 14 March · Landmark Centre"]),
    true,
  ],
  [
    "H23",
    "date",
    "Friday 14 March",
    copy("Building for Heat", "Fri 14 Mar, 4pm"),
    true,
  ],
  [
    "H24",
    "date",
    "Friday 14 March",
    copy("Building for Heat", "Saturday 14 March"),
    false,
  ],
  [
    "H25",
    "date",
    "Friday 14 March",
    copy("Building for Heat", "14 March, Saturday"),
    false,
  ],
  [
    "H26",
    "time",
    "at 4pm",
    copy("Building for Heat", "", "", ["Starts at 4pm"]),
    true,
  ],
  ["H27", "time", "at 4pm", copy("Register by 14:00"), false],
  ["H28", "time", "at 4pm", copy("Panel at 16:00"), true],
  /* recruitment-ko */
  [
    "H29",
    "date",
    "30 November",
    copy("Senior React engineers", "", "Apply by 30 Nov"),
    true,
  ],
  [
    "H30",
    "date",
    "30 November",
    copy("Senior React engineers", "Apply by 3 November"),
    false,
  ],
  [
    "H31",
    "quantity",
    "two senior React engineers",
    copy("We're hiring 2 senior React engineers"),
    true,
  ],
  [
    "H32",
    "quantity",
    "two senior React engineers",
    copy("Join 200 senior React engineers"),
    false,
  ],
  /* fitness-ko */
  ["H33", "time", "6am", copy("HIIT at 6am every weekday"), true],
  ["H34", "time", "6am", copy("06:00 HIIT, Monday to Friday"), true],
  ["H35", "time", "6am", copy("6pm HIIT every weekday"), false],
  ["H36", "time", "6am", copy("Classes of 6, 6 days a week"), false],
  /* cafe-photo-upload */
  [
    "H37",
    "price",
    "three shots for ₦6,000",
    copy("Three shots for ₦6,000"),
    true,
  ],
  [
    "H38",
    "price",
    "three shots for ₦6,000",
    copy("The flight", "₦6,000 for three shots of single origin."),
    true,
  ],
  [
    "H39",
    "price",
    "three shots for ₦6,000",
    copy("₦6,000 for two shots"),
    false,
  ],
  ["H40", "price", "three shots for ₦6,000", copy("3 shots, ₦6,000"), true],
  [
    "H41",
    "time",
    "every weekday from 8am",
    copy("Espresso flight", "Every weekday from 8am at our Yaba bar."),
    true,
  ],
  [
    "H42",
    "time",
    "every weekday from 8am",
    copy("Espresso flight", "From 8am at our Yaba bar."),
    false,
  ],
  [
    "H43",
    "time",
    "every weekday from 8am",
    copy("Espresso flight", "Weekdays from 8am."),
    true,
  ],
  /* fashion-portrait-upload */
  [
    "H44",
    "price",
    "₦38,000",
    copy("The Harmattan linen dress", "₦38,000 on adirehouse.ng"),
    true,
  ],
  ["H45", "price", "₦38,000", copy("Harmattan linen, N38k"), true],
  [
    "H46",
    "date",
    "Friday 1 November",
    copy("Harmattan linen", "Pre-orders open 1 November."),
    true,
  ],
  [
    "H47",
    "date",
    "Friday 1 November",
    copy("Harmattan linen", "Pre-orders open Sunday · 1 November"),
    false,
  ],
  /* masterclass-ko */
  [
    "H49",
    "date",
    "Sunday 9 November",
    copy("Latte art masterclass", "", "", ["Sun 9 Nov · 2pm to 5pm"]),
    true,
  ],
  ["H50", "time", "2pm to 5pm", copy("Latte art", "Sunday, 2-5pm"), true],
  ["H51", "time", "2pm to 5pm", copy("Latte art", "Sunday from 2pm"), false],
  ["H52", "time", "2pm to 5pm", copy("Latte art", "14:00–17:00"), true],
  [
    "H53",
    "price",
    "₦25,000 per person",
    copy("Latte art", "₦25,000 per person, all milk and beans included"),
    true,
  ],
  [
    "H54",
    "price",
    "₦25,000 per person",
    copy("Latte art", "₦25,000 for 2 people"),
    false,
  ],
  ["H55", "age", "ages 16 and up", copy("Latte art", "Ages 16+"), true],
  [
    "H56",
    "age",
    "ages 16 and up",
    copy("Latte art", "16+ cups poured every session"),
    false,
  ],
  [
    "H57",
    "age",
    "ages 16 and up",
    copy("Latte art", "For ages 16 and up."),
    true,
  ],
  ["H58", "quantity", "10 seats", copy("Latte art", "Only 10 seats."), true],
  [
    "H59",
    "quantity",
    "10 seats",
    copy("Latte art", "100 seats sold out"),
    false,
  ],
  [
    "H60",
    "quantity",
    "10 seats",
    copy("Latte art", "", "", ["Seats: 10"]),
    true,
  ],
  /* workshop-blank-upload */
  [
    "H61",
    "time",
    "10am to 12pm",
    copy("Croissant workshop", "This Saturday, 10am–12pm."),
    true,
  ],
  [
    "H62",
    "time",
    "10am to 12pm",
    copy("Croissant workshop", "This Saturday from 10am."),
    false,
  ],
  [
    "H63",
    "age",
    "ages 7 to 12",
    copy("Croissant workshop", "For kids aged 7-12."),
    true,
  ],
  ["H64", "age", "ages 7 to 12", copy("Croissant workshop", "Ages 7+"), false],
  [
    "H65",
    "age",
    "ages 7 to 12",
    copy("Croissant workshop", "Bake 7 to 12 croissants each"),
    false,
  ],
  [
    "H66",
    "quantity",
    "only 8 spots",
    copy("Croissant workshop", "Just 8 spots left."),
    true,
  ],
  [
    "H67",
    "price",
    "₦15,000 per child",
    copy("Croissant workshop", "₦15,000 per child"),
    true,
  ],
  /* kimono-wide-upload */
  [
    "H68",
    "time",
    "Monday to Friday, 10am to 6pm",
    copy("The Ofe kimono", "", "", ["Try it on Mon–Fri, 10am–6pm"]),
    true,
  ],
  [
    "H69",
    "time",
    "Monday to Friday, 10am to 6pm",
    copy("The Ofe kimono", "Try it on, 10am to 6pm."),
    false,
  ],
  [
    "H70",
    "time",
    "Monday to Friday, 10am to 6pm",
    copy("The Ofe kimono", "Try it on Saturday, 10am to 6pm."),
    false,
  ],
  [
    "H71",
    "quantity",
    "only 20 pieces",
    copy("The Ofe kimono", "Only 20 pieces made."),
    true,
  ],
  [
    "H72",
    "quantity",
    "only 20 pieces",
    copy("The Ofe kimono", "120 pieces sold"),
    false,
  ],
  /* tutoring-ko */
  [
    "H73",
    "price",
    "₦45,000 a month",
    copy("Maths and physics at home", "₦45,000 a month, first session free."),
    true,
  ],
  [
    "H74",
    "price",
    "₦45,000 a month",
    copy("Maths and physics at home", "₦45,000 a term."),
    false,
  ],
  [
    "H75",
    "quantity",
    "Two 90-minute sessions a week",
    copy("Maths and physics at home", "Two 90-min sessions a week."),
    true,
  ],
  [
    "H76",
    "quantity",
    "Two 90-minute sessions a week",
    copy("Maths and physics at home", "90-minute sessions at home."),
    false,
  ],
  /* pottery-evening-ko */
  [
    "H77",
    "date",
    "Thursday 20 November",
    copy("Wheel-throwing evening", "Thu 20 Nov, 6pm"),
    true,
  ],
  [
    "H78",
    "time",
    "6pm to 9pm",
    copy("Wheel-throwing evening", "Thursday, 6–9pm"),
    true,
  ],
  [
    "H79",
    "time",
    "6pm to 9pm",
    copy("Wheel-throwing evening", "Thursday from 6pm"),
    false,
  ],
  [
    "H80",
    "age",
    "18+",
    copy("Wheel-throwing evening", "Adults only, 18+."),
    true,
  ],
  [
    "H81",
    "age",
    "18+",
    copy("Wheel-throwing evening", "18+ glazes to choose from"),
    false,
  ],
  [
    "H82",
    "quantity",
    "Just 10 seats",
    copy("Wheel-throwing evening", "10 seats only."),
    true,
  ],
  [
    "H83",
    "place",
    "14 Bode Thomas Street",
    copy(
      "Wheel-throwing evening",
      "Clay Room, 14 Bode Thomas Street, Surulere",
    ),
    true,
  ],
  [
    "H84",
    "place",
    "14 Bode Thomas Street",
    copy("Wheel-throwing evening", "Clay Room, 4 Bode Thomas Street"),
    false,
  ],
  /* storefront-reopening-upload */
  [
    "H85",
    "date",
    "Saturday 6 December",
    copy("We're back", "Reopening Saturday 6 December."),
    true,
  ],
  [
    "H86",
    "date",
    "Saturday 6 December",
    copy("We're back", "Reopening Sunday 6 December."),
    false,
  ],
  [
    "H87",
    "price",
    "₦38,000 for 5 yards",
    copy("We're back", "Lace bundles at ₦38,000 for 5 yards."),
    true,
  ],
  [
    "H88",
    "price",
    "₦38,000 for 5 yards",
    copy("We're back", "Lace bundles at ₦38,000 for 3 yards."),
    false,
  ],
  ["H89", "time", "9am to 5pm", copy("We're back", "Open 9am–5pm."), true],
  ["H90", "time", "9am to 5pm", copy("We're back", "Doors open 9am."), false],
  [
    "H91",
    "price",
    "₦6,500 a yard",
    copy("We're back", "Ankara from ₦6,500/yard."),
    true,
  ],
  /* retreat-sky-upload */
  [
    "H92",
    "date",
    "Friday 12 December to Sunday 14 December",
    copy("A weekend of stillness", "12–14 December outside Ibadan."),
    true,
  ],
  [
    "H93",
    "date",
    "Friday 12 December to Sunday 14 December",
    copy("A weekend of stillness", "Arrive Friday 12 December."),
    false,
  ],
  [
    "H94",
    "date",
    "Friday 12 December to Sunday 14 December",
    copy("A weekend of stillness", "Fri 12 – Sun 14 Dec"),
    true,
  ],
  [
    "H95",
    "quantity",
    "16 places",
    copy("A weekend of stillness", "Only 16 places."),
    true,
  ],
  [
    "H96",
    "quantity",
    "16 places",
    copy("A weekend of stillness", "16 places to see around Ibadan"),
    false,
  ],
  [
    "H97",
    "price",
    "₦120,000 per person",
    copy("A weekend of stillness", "₦120k per person, all meals included."),
    true,
  ],
];

/** True rows the contract refuses on purpose: the fact writer writes the
 *  fact in its own form. Each costs at most two asks. */
export const HOLDOUT_FAIL_CLOSED: Record<string, string> = {
  H20: "a count's words in another order or split ('20 countries across Africa') are not its form",
  H40: "an amount and its count joined by a comma ('3 shots, ₦6,000') are not a price form",
  H92: "a day range followed by a place word ('12–14 December outside Ibadan') ends where no date may",
};

describe("holdout: copy for the eval briefs, labelled before the round-12 fixes", () => {
  it.each(HOLDOUT_ROWS)("%s: %s %j", (id, kind, text, design, stated) => {
    const want = id in HOLDOUT_FAIL_CLOSED ? false : stated;
    expect(factStated(fact(kind, text), design)).toBe(want);
  });

  it("records only true rows as refused on purpose", () => {
    for (const id of Object.keys(HOLDOUT_FAIL_CLOSED)) {
      expect(HOLDOUT_ROWS.find((r) => r[0] === id)?.[4]).toBe(true);
    }
  });
});
