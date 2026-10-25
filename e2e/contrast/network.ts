/**
 * Chromium's errors for a request the host's network cut, not the page.
 *
 * A clean run went red on `brand (dark)` when `net::ERR_NETWORK_CHANGED`
 * hit the app's own `layout.js`: the route passed in every other run. These
 * are kept as evidence and the route is loaded once more. The same error on
 * the second load fails the pass, since a page that cannot load twice is
 * not the network's doing, and so does one after the first load finished:
 * by then the page is being measured, and a reload would measure another.
 */
const NETWORK_BLIPS = [
  /net::ERR_NETWORK_CHANGED/,
  /net::ERR_NETWORK_IO_SUSPENDED/,
  /net::ERR_INTERNET_DISCONNECTED/,
];

export function isNetworkBlip(text: string): boolean {
  return NETWORK_BLIPS.some((pattern) => pattern.test(text));
}

export interface LoadState {
  /** The route's first load has finished. */
  loaded: boolean;
  /** The route was loaded once more after a cut. */
  reloaded: boolean;
}

/** What a console line means for the pass: a cut on the first load reloads
 *  once, any other cut fails it, anything else is not this rule's. */
export function networkCut(
  text: string,
  state: LoadState,
): "reload" | "fail" | "other" {
  if (!isNetworkBlip(text)) return "other";
  return state.loaded || state.reloaded ? "fail" : "reload";
}
