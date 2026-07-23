/** SSRF guard for the admin logo proxy. logoUrl is user-controllable (written
 * verbatim from the brand form), so the proxy may fetch it server-side only
 * when it points at our own R2 storage origin — an internal or attacker URL
 * can never match, and origin equality pins protocol, host and port. */
export function isTrustedStorageUrl(
  candidate: string,
  publicBaseUrl: string | undefined,
): boolean {
  if (!publicBaseUrl) return false;
  try {
    return new URL(candidate).origin === new URL(publicBaseUrl).origin;
  } catch {
    return false;
  }
}
