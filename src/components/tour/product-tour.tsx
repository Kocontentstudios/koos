"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useSidebarCollapse } from "@/components/layout/sidebar-context";
import { captureEvent } from "@/lib/analytics/posthog-client";
import { TOUR_FINISH_LABEL, TOUR_PROMPT, TOUR_STEPS } from "@/lib/tour/steps";
import { TourCard } from "./tour-card";
import { TourPopover } from "./tour-popover";
import {
  isMobileViewport,
  scrollAnchorIntoView,
  useTourAnchor,
} from "./use-tour-anchor";

/** Per-tab resume cursor. Completion lives in the DB; this is throwaway. */
const RESUME_KEY = "koos_tour_step";
/** Defined in globals.css — a box-shadow ring, so it never reflows the page. */
const HIGHLIGHT_CLASS = "koos-tour-highlight";

type ExitReason = "completed" | "skipped" | "closed" | "escape" | "outside";
/** -1 is the opening prompt card; 0..n index into TOUR_STEPS. */
type Phase = number | "done";

function readResume(): number | null {
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; index?: number };
    if (parsed.v !== 1 || typeof parsed.index !== "number") return null;
    if (parsed.index < 0 || parsed.index >= TOUR_STEPS.length) return null;
    return parsed.index;
  } catch {
    return null;
  }
}

export function ProductTour({
  startAt,
}: {
  /** "prompt" offers the tour; "step" is a replay that already opted in. */
  startAt: "prompt" | "step";
}) {
  const router = useRouter();
  const { openMobile, closeMobile } = useSidebarCollapse();
  const forced = startAt === "step";

  const [phase, setPhase] = useState<Phase>(() => (forced ? 0 : -1));
  const exited = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  // Resume a refresh mid-tour rather than dumping the user back at the prompt.
  useEffect(() => {
    if (forced) return;
    const resumed = readResume();
    if (resumed !== null) setPhase(resumed);
  }, [forced]);

  const index = typeof phase === "number" && phase >= 0 ? phase : null;
  const step = index === null ? null : TOUR_STEPS[index];
  const { element, resolved } = useTourAnchor(step?.anchor ?? null);

  const finish = useCallback(
    (reason: ExitReason) => {
      // React 19 double-invokes effects in dev; the tour must resolve once.
      if (exited.current) return;
      exited.current = true;
      setPhase("done");
      closeMobile();

      try {
        window.sessionStorage.removeItem(RESUME_KEY);
      } catch {
        // Private mode — nothing to clean up.
      }

      // A replay must not rewrite the column: it records the FIRST resolution.
      if (forced) {
        router.replace("/dashboard");
        return;
      }

      void fetch("/api/tour/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          stepIndex: index ?? 0,
        }),
        // Survives a dismissal that is immediately followed by navigation.
        keepalive: true,
      }).catch(() => {
        // Worst case the prompt returns once more; never block the user.
      });
    },
    [closeMobile, forced, index, router],
  );

  // Drawer + scroll + analytics for whichever step is showing.
  useEffect(() => {
    if (step === null) return;
    if (isMobileViewport()) {
      if (step.isNav) openMobile();
      else closeMobile();
    }
    captureEvent("product_tour_step_viewed", {
      step_id: step.id,
      step_index: index,
    });
    try {
      window.sessionStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ v: 1, index }),
      );
    } catch {
      // Resume is a convenience, not a requirement.
    }
  }, [step, index, openMobile, closeMobile]);

  useEffect(() => {
    scrollAnchorIntoView(element, step?.isNav ?? false);
  }, [element, step]);

  /* "Highlights key parts of the app one by one" — a popover beside a nav row
     is not enough on its own; the row itself has to read as the subject. */
  useEffect(() => {
    if (!element) return;
    element.classList.add(HIGHLIGHT_CLASS);
    return () => element.classList.remove(HIGHLIGHT_CLASS);
  }, [element]);

  // An anchor that never resolved means the DOM drifted from the step list.
  useEffect(() => {
    if (step?.anchor && resolved && element === null) {
      captureEvent("product_tour_anchor_missing", { anchor_id: step.anchor });
    }
  }, [step, resolved, element]);

  useEffect(() => {
    if (phase === "done") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("escape");
      if (index === null) return;
      if (e.key === "ArrowRight" && index < TOUR_STEPS.length - 1) {
        setPhase(index + 1);
      }
      if (e.key === "ArrowLeft" && index > 0) setPhase(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, index, finish]);

  if (phase === "done") return null;

  if (phase === -1) {
    return (
      <>
        <TourAnnouncement text={TOUR_PROMPT.headline} />
        <CenteredShell titleId={titleId} bodyId={bodyId}>
          <TourCard
            title={TOUR_PROMPT.headline}
            body={TOUR_PROMPT.body}
            step={null}
            total={TOUR_STEPS.length}
            primaryLabel={TOUR_PROMPT.start}
            secondaryLabel={TOUR_PROMPT.skip}
            titleId={titleId}
            bodyId={bodyId}
            onPrimary={() => {
              captureEvent("product_tour_started");
              setPhase(0);
            }}
            onSecondary={() => finish("skipped")}
            onClose={() => finish("closed")}
          />
        </CenteredShell>
      </>
    );
  }

  if (step === null || index === null) return null;

  const isLast = index === TOUR_STEPS.length - 1;
  const card = (
    <TourCard
      /* Remounting per step re-runs the focus effect, so the primary button
         follows the user forward instead of stranding keyboard focus. */
      key={step.id}
      title={step.title}
      body={step.body}
      step={index + 1}
      total={TOUR_STEPS.length}
      primaryLabel={isLast ? TOUR_FINISH_LABEL : "Next"}
      secondaryLabel={index > 0 ? "Back" : undefined}
      titleId={titleId}
      bodyId={bodyId}
      onPrimary={() => (isLast ? finish("completed") : setPhase(index + 1))}
      onSecondary={index > 0 ? () => setPhase(index - 1) : undefined}
      onClose={() => finish("closed")}
    />
  );

  const announcement = (
    <TourAnnouncement
      text={`Step ${index + 1} of ${TOUR_STEPS.length}: ${step.title}`}
    />
  );

  // No anchor, or an anchor that vanished: still deliver the copy.
  if (!element) {
    return (
      <>
        {announcement}
        <CenteredShell titleId={titleId} bodyId={bodyId}>
          {card}
        </CenteredShell>
      </>
    );
  }

  return (
    <>
      {announcement}
      <TourPopover
        anchor={element}
        side={step.side}
        titleId={titleId}
        bodyId={bodyId}
        onClose={(reason) =>
          finish(reason === "other" ? "closed" : (reason as ExitReason))
        }
      >
        {card}
      </TourPopover>
    </>
  );
}

/** Without this a screen reader gets a silent content swap on every step. */
function TourAnnouncement({ text }: { text: string }) {
  return (
    <span aria-live="polite" className="sr-only">
      {text}
    </span>
  );
}

function CenteredShell({
  titleId,
  bodyId,
  children,
}: {
  titleId: string;
  bodyId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--backdrop)] p-4">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="rounded-2xl border border-[var(--border-accent)] bg-surface-1 p-5 shadow-[var(--shadow-modal)]"
      >
        {children}
      </div>
    </div>
  );
}
