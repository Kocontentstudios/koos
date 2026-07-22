"use client";

import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { Suspense, useEffect } from "react";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

function ensureInit() {
  if (initialized || !KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    // App-router SPA: we capture pageviews manually on route changes.
    capture_pageview: false,
    capture_pageleave: true,
  });
  initialized = true;
}

/** Captures a $pageview on every app-router navigation. */
function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!KEY || !pathname) return;
    ensureInit();
    let url = window.origin + pathname;
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

/**
 * Client-side PostHog. Renders nothing and does nothing unless
 * NEXT_PUBLIC_POSTHOG_KEY is set. useSearchParams requires a Suspense
 * boundary so static rendering isn't forced dynamic.
 */
export function PostHogProvider() {
  if (!KEY) return null;
  return (
    <Suspense fallback={null}>
      <PageviewTracker />
    </Suspense>
  );
}
