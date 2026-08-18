"use client";

import posthog from "posthog-js";

/**
 * Browser-side PostHog lifecycle: init, identity, and reset. Mirrors
 * posthog-server.ts — a silent no-op when NEXT_PUBLIC_POSTHOG_KEY is unset.
 *
 * Identity is the reason this module exists. Server events use the DB user id
 * as distinctId while the browser generates its own anonymous id, so without
 * identify() every person exists twice and no funnel can span a client event
 * and a server event.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

export function isAnalyticsEnabled(): boolean {
  return Boolean(KEY);
}

export function ensureInit(): boolean {
  if (!KEY) return false;
  if (!initialized) {
    posthog.init(KEY, {
      api_host: HOST,
      // App-router SPA: we capture pageviews manually on route changes.
      capture_pageview: false,
      capture_pageleave: true,
    });
    initialized = true;
  }
  return true;
}

/**
 * Links this browser to the DB user id.
 *
 * The guard is not an optimization. posthog-js only performs the
 * anonymous-to-known merge while the distinct_id is still the generated one;
 * identifying an already-identified browser as someone else is refused with a
 * console warning rather than re-aliased. Re-calling with the same id would
 * also emit a redundant $identify on every navigation.
 *
 * Sends no person properties — the user id is all a funnel needs, and email
 * and name would be PII leaving for a third party without being asked for.
 */
export function identifyUser(userId: string): void {
  if (!userId) return;
  if (!ensureInit()) return;
  if (posthog.get_distinct_id() === userId) return;
  posthog.identify(userId);
}

/**
 * Drops the identity so the next person on a shared browser starts anonymous
 * instead of inheriting the previous user's events. Nothing to reset if the
 * SDK never initialized, and calling into an uninitialized posthog throws.
 */
export function resetIdentity(): void {
  if (!KEY || !initialized) return;
  posthog.reset();
}
