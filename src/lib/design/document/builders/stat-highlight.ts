import { card } from "./card";
import type { Built, Context } from "./context";

/** A number as the headline, on a card edged in the accent. */
export function statHighlight(ctx: Context): Promise<Built> {
  return card(ctx, "stat");
}
