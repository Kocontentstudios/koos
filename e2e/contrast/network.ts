/**
 * Chromium's errors for a request the host's network cut, not the page.
 *
 * A clean run went red on `brand (dark)` when `net::ERR_NETWORK_CHANGED`
 * hit the app's own `layout.js`: the route passed in every other run. These
 * are kept as evidence and the route is loaded once more; the same error on
 * the second load fails the pass, since a page that cannot load twice is
 * not the network's doing.
 */
const NETWORK_BLIPS = [
  /net::ERR_NETWORK_CHANGED/,
  /net::ERR_NETWORK_IO_SUSPENDED/,
  /net::ERR_INTERNET_DISCONNECTED/,
];

export function isNetworkBlip(text: string): boolean {
  return NETWORK_BLIPS.some((pattern) => pattern.test(text));
}
