"use client";

import { useEffect } from "react";
import { identifyUser } from "@/lib/analytics/posthog-client";

/**
 * Renders nothing. Mounted from layouts that guarantee a session, so the
 * browser's anonymous id is merged into the DB user id as early as possible.
 */
export function PostHogIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    identifyUser(userId);
  }, [userId]);

  return null;
}
