export async function checkRateLimit() {
  return { ok: true, retryAfterSeconds: 0 };
}
export function tooManyRequests() {
  return new Response(null, { status: 429 });
}
