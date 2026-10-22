import { card } from "./card";
import type { Built, Context } from "./context";

/** A pull quote on a card, opened by a quote mark in the accent. */
export function quoteCard(ctx: Context): Promise<Built> {
  return card(ctx, "quote");
}
