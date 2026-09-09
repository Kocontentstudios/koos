/** Pure write logic for a delivery round. Framework-free so it's unit-tested. */

export interface DeliveryPatch {
  status: "ready_for_review";
  updatedAt: Date;
  deliveredAt?: Date;
}

/**
 * What a delivery round changes on the ticket.
 *
 * `deliveredAt` is set on the FIRST round only. A correction round is not a new
 * delivery: writing it every time would make a months-old ticket look freshly
 * delivered each time it was revised, and Delivered Projects sorts and filters
 * on that date. The column is also never cleared, so this is the only place its
 * value is decided.
 *
 * Separated from the transaction because that decision is the part that can be
 * wrong, and it is the part a test can reach.
 */
export function deliveryPatchFor(version: number, now: Date): DeliveryPatch {
  const patch: DeliveryPatch = { status: "ready_for_review", updatedAt: now };
  if (version === 1) patch.deliveredAt = now;
  return patch;
}
