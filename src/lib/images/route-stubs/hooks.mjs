/**
 * Module hooks for svg-attack-child.mts: the route handlers run as they are,
 * and only what reaches past them (the session, the database, the rate
 * limiter, the vision model) is answered by the stubs beside this file.
 * Storage is the real module over a stubbed S3 client.
 */
const STUBS = {
  "@/lib/auth/get-user": "get-user.mjs",
  "@/lib/auth/workspace-guard": "workspace-guard.mjs",
  "@/lib/db/queries": "queries.mjs",
  "@/lib/rate-limit": "rate-limit.mjs",
  "@/lib/ai/logo-colors": "logo-colors.mjs",
};

/* Synchronous hooks (module.registerHooks), because tsx registers its own
   that way, and only a later in-thread hook runs ahead of its "@/" mapping. */
export function resolve(specifier, context, next) {
  const stub = STUBS[specifier];
  if (stub) {
    return { url: new URL(stub, import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
