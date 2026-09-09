/** The Design Tickets chooser links here with ?pick=design so the calendar can
 *  explain why the user arrived. Anything else is an ordinary calendar visit. */
export function isPickDesign(pick: string | undefined): boolean {
  return pick === "design";
}
