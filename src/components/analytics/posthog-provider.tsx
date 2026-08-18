"use client";

import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { Suspense, useEffect } from "react";
import { ensureInit, isAnalyticsEnabled } from "@/lib/analytics/posthog-client";

/** Captures a $pageview on every app-router navigation. */
function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    if (!ensureInit()) return;
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
 *
 * Identity is handled separately by PostHogIdentify, which needs a session
 * and so mounts from the authenticated layouts rather than the root.
 */
export function PostHogProvider() {
  if (!isAnalyticsEnabled()) return null;
  return (
    <Suspense fallback={null}>
      <PageviewTracker />
    </Suspense>
  );
}
