"use client";

import {
  ArrowLeft,
  ChevronDown,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useEscapeLayer } from "@/components/design/directions/escape-layer";
import {
  FlowDescription,
  FlowTitle,
} from "@/components/design/directions/flow-heading";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  type ApprovedOutline,
  FRAME_BOUNDS,
  type OutlinePoint,
  type SequenceKind,
} from "@/lib/design/sequence/contract";
import { cn } from "@/lib/utils";
import {
  canAdd,
  canRemove,
  countOptions,
  draftProblems,
  FIELD_LIMITS,
  fieldProblem,
  generateLabel,
  type OutlineDraft,
  type OutlineField,
  sourceLabel,
  toApproved,
  unstatedFacts,
  weakCount,
  weakReason,
} from "./outline-model";
import { kindNoun, roleLabel, slideCount } from "./set-model";
import type { OutlineController } from "./use-outline";

const FIELD_LABELS: Record<OutlineField, string> = {
  title: "Title",
  point: "Point",
};

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <DialogFooter className="mt-4 max-sm:rounded-b-none max-sm:pb-10 sm:justify-between">
      {children}
    </DialogFooter>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button type="button" variant="ghost" onClick={onBack}>
      <ArrowLeft aria-hidden="true" />
      Back
    </Button>
  );
}

function Heading({ kind }: { kind: SequenceKind }) {
  return (
    <div className="flex flex-col gap-1.5 pr-8 pb-4 max-sm:pr-14 [@media(hover:none)]:pr-14">
      <FlowTitle>Plan your {kindNoun(kind)}</FlowTitle>
      <FlowDescription>
        Each point becomes one slide. Change the words, add or remove slides,
        then generate. Nothing is made or counted until you press Generate.
      </FlowDescription>
    </div>
  );
}

function OutlineLoading({
  kind,
  count,
}: {
  kind: SequenceKind;
  count: number | null;
}) {
  const rows = count ?? FRAME_BOUNDS[kind].fallback;
  return (
    <div role="status" className="flex flex-col gap-3">
      <p className="text-[13px] text-[var(--text-secondary)]">
        {count
          ? `Planning ${slideCount(count)} from your brief…`
          : "Planning the slides from your brief…"}
      </p>
      <ul aria-hidden="true" className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-xl border p-4"
            style={{ borderColor: "var(--border-control)" }}
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutlineProblemPanel({
  tone,
  title,
  message,
  onRetry,
}: {
  tone: "error" | "empty";
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex flex-col items-center gap-3 py-6 text-center"
    >
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-full",
          tone === "error"
            ? "bg-[var(--status-error-bg)] text-[var(--status-error-fg)]"
            : "bg-[var(--status-draft-bg)] text-[var(--text-secondary)]",
        )}
      >
        {tone === "error" ? (
          <TriangleAlert aria-hidden="true" className="size-6" />
        ) : (
          <Sparkles aria-hidden="true" className="size-6" />
        )}
      </span>
      <div className="flex max-w-[440px] flex-col gap-1.5">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {message}
        </p>
      </div>
      <Button type="button" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}

/* Chrome scrolls a focused textarea only far enough to show its caret, which
   leaves the rest of the field and its focus outline under the dialog's
   edge. Revealing the whole box honours the scroller's scroll-padding. */
export const REVEAL_ON_FOCUS = {
  "data-reveal-on-focus": "",
  onFocus: (e: React.FocusEvent<HTMLElement>) =>
    e.currentTarget.scrollIntoView?.({ block: "nearest" }),
} as const;

function fieldId(base: string, pointId: string, field: OutlineField): string {
  return `${base}-${pointId}-${field}`;
}

function OutlineFieldInput({
  base,
  point,
  field,
  slideName,
  showProblem,
  locked,
  onEdit,
}: {
  base: string;
  point: OutlinePoint;
  field: OutlineField;
  slideName: string;
  showProblem: boolean;
  locked: boolean;
  onEdit: (value: string) => void;
}) {
  const id = fieldId(base, point.id, field);
  const problemId = `${id}-problem`;
  const countId = `${id}-count`;
  const value = point[field];
  const limit = FIELD_LIMITS[field];
  const problem = showProblem ? fieldProblem(field, value) : null;
  const shared = {
    id,
    value,
    maxLength: limit,
    readOnly: locked,
    "aria-invalid": problem ? true : undefined,
    "aria-describedby": problem ? `${problemId} ${countId}` : countId,
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[12px] font-semibold text-[var(--text-secondary)]"
        >
          {FIELD_LABELS[field]}
          <span className="sr-only">, {slideName}</span>
        </label>
        <span
          id={countId}
          className={cn(
            "text-[11px] tabular-nums",
            value.length >= limit
              ? "text-[var(--status-pending-fg)]"
              : "text-[var(--text-muted)]",
          )}
        >
          <span className="sr-only">Characters used: </span>
          {value.length}/{limit}
        </span>
      </div>
      {field === "title" ? (
        <Input
          {...shared}
          placeholder="Two to four words"
          onChange={(e) => onEdit(e.target.value)}
        />
      ) : (
        <Textarea
          {...shared}
          rows={2}
          className="min-h-14 scroll-my-2"
          {...REVEAL_ON_FOCUS}
          placeholder="What this slide tells the reader, in one sentence"
          /* A point is one sentence on one slide; Enter would only add a
             line break the server refuses. */
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          onChange={(e) => onEdit(e.target.value)}
        />
      )}
      {problem ? (
        <p id={problemId} className="text-[12px] text-[var(--status-error-fg)]">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function WeakCallout({
  base,
  point,
  reason,
  slideName,
  locked,
  onReplace,
}: {
  base: string;
  point: OutlinePoint;
  reason: string;
  slideName: string;
  locked: boolean;
  onReplace: (value: string) => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const [own, setOwn] = useState("");
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  useEscapeLayer(replacing, () => setReplacing(false));
  const shown = useRef(replacing);
  /* The pressed button is replaced by the field (and back), so focus is
     moved by hand both ways rather than dropping to the dialog. */
  useEffect(() => {
    if (shown.current === replacing) return;
    shown.current = replacing;
    (replacing ? ownRef : openRef).current?.focus();
  }, [replacing]);
  const ownId = `${base}-${point.id}-own`;
  const problem = own ? fieldProblem("point", own) : null;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg bg-[var(--status-pending-bg)] p-3"
      data-weak={point.weak?.kind}
    >
      <p className="flex gap-2 text-[12px] leading-snug text-[var(--status-pending-fg)]">
        <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>
          <span className="sr-only">May be weak: </span>
          {reason}
        </span>
      </p>
      {replacing ? (
        <form
          className="flex flex-col gap-2"
          aria-label={`Replace the point on ${slideName}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (own.trim() && !problem && !locked) onReplace(own);
          }}
        >
          <label
            htmlFor={ownId}
            className="text-[12px] font-semibold text-foreground"
          >
            Your point for {slideName}
          </label>
          <Textarea
            ref={ownRef}
            id={ownId}
            rows={2}
            className="min-h-14 scroll-my-2"
            {...REVEAL_ON_FOCUS}
            value={own}
            readOnly={locked}
            maxLength={FIELD_LIMITS.point}
            placeholder="Something true about your business, in one sentence"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${ownId}-problem` : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            onChange={(e) => setOwn(e.target.value.replace(/[\r\n\t]+/g, " "))}
          />
          {problem ? (
            <p
              id={`${ownId}-problem`}
              className="text-[12px] text-[var(--status-error-fg)]"
            >
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setReplacing(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={locked || !own.trim() || problem !== null}
              focusableWhenDisabled
            >
              Use my point
            </Button>
          </div>
        </form>
      ) : (
        <Button
          ref={openRef}
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={locked}
          focusableWhenDisabled
          onClick={() => setReplacing(true)}
          aria-label={`Replace with my own point, ${slideName}`}
        >
          Replace with my own point
        </Button>
      )}
    </div>
  );
}

function PointCard({
  base,
  draft,
  point,
  index,
  showProblems,
  locked,
  onEdit,
  onRemove,
}: {
  base: string;
  draft: OutlineDraft;
  point: OutlinePoint;
  index: number;
  showProblems: boolean;
  locked: boolean;
  onEdit: (field: OutlineField, value: string) => void;
  onRemove: () => void;
}) {
  const role = roleLabel(draft.kind, point.role);
  const slideName = `slide ${index + 1}`;
  const reason = weakReason(draft, point);
  const removable = canRemove(draft, point.id);
  const headingId = `${base}-${point.id}-heading`;

  return (
    <li
      aria-labelledby={headingId}
      data-point={point.id}
      className="flex flex-col gap-3 rounded-xl border bg-[var(--surface-container-low)] p-4"
      style={{
        borderColor: reason
          ? "var(--status-pending-fg)"
          : "var(--border-control)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={headingId}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
        >
          <span className="font-semibold text-foreground">
            Slide {index + 1} · {role}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              point.source === "user"
                ? "bg-[var(--status-progress-bg)] text-[var(--status-progress-fg)]"
                : "bg-[var(--status-draft-bg)] text-[var(--text-secondary)]",
            )}
          >
            <span className="sr-only">, </span>
            {sourceLabel(point.source)}
          </span>
        </h3>
        {point.role === "body" ? (
          <Button
            type="button"
            variant="icon"
            size="icon-sm"
            onClick={onRemove}
            disabled={locked || !removable}
            focusableWhenDisabled
            aria-label={`Delete ${slideName}${point.title.trim() ? `, ${point.title.trim()}` : ""}`}
            title={
              removable
                ? undefined
                : `A ${kindNoun(draft.kind)} needs at least ${FRAME_BOUNDS[draft.kind].min} slides.`
            }
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <OutlineFieldInput
        base={base}
        point={point}
        field="title"
        slideName={slideName}
        showProblem={showProblems}
        locked={locked}
        onEdit={(value) => onEdit("title", value)}
      />
      <OutlineFieldInput
        base={base}
        point={point}
        field="point"
        slideName={slideName}
        showProblem={showProblems}
        locked={locked}
        onEdit={(value) => onEdit("point", value)}
      />
      {reason ? (
        <WeakCallout
          base={base}
          point={point}
          reason={reason}
          slideName={slideName}
          locked={locked}
          onReplace={(value) => {
            onEdit("point", value);
            document.getElementById(fieldId(base, point.id, "point"))?.focus();
          }}
        />
      ) : null}
    </li>
  );
}

/* The base layer gives every select 12px of vertical padding; at 44px that
   leaves no room for the number, so the padding is cleared here and the
   spec's 0 14px applies. The native chevron is replaced so it matches the
   spec's 16px muted arrow in both themes. */
export const COUNT_SELECT_CLASS =
  "h-11 w-24 appearance-none rounded-[10px] border border-input bg-transparent py-0 pr-9 pl-3.5 text-[14px] leading-normal text-foreground focus-visible:focus-outline disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

function CountControl({
  base,
  draft,
  replanning,
  locked,
  onReplan,
}: {
  base: string;
  draft: OutlineDraft;
  replanning: number | null;
  locked: boolean;
  onReplan: (count: number) => void;
}) {
  const current = draft.points.length;
  const [count, setCount] = useState(current);
  const [confirming, setConfirming] = useState(false);
  useEscapeLayer(confirming, () => setConfirming(false));
  useEffect(() => setCount(current), [current]);
  const keepRef = useRef<HTMLButtonElement>(null);
  const replanRef = useRef<HTMLButtonElement>(null);
  const shown = useRef(confirming);
  useEffect(() => {
    if (shown.current === confirming) return;
    shown.current = confirming;
    (confirming ? keepRef : replanRef).current?.focus();
  }, [confirming]);
  const selectId = `${base}-count`;
  const promptId = `${base}-count-prompt`;

  if (confirming) {
    return (
      <fieldset
        aria-labelledby={promptId}
        className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "var(--border-control)" }}
      >
        <p id={promptId} className="text-[13px] text-[var(--text-secondary)]">
          <span className="font-semibold text-foreground">
            Re-plan as {slideCount(count)}?
          </span>{" "}
          KO writes a new outline and your edits are replaced.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            ref={keepRef}
            onClick={() => setConfirming(false)}
          >
            Keep my edits
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setConfirming(false);
              onReplan(count);
            }}
          >
            Re-plan
          </Button>
        </div>
      </fieldset>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label
          htmlFor={selectId}
          className="text-[12px] font-semibold text-[var(--text-secondary)]"
        >
          Number of slides
        </label>
        <div className="relative">
          <select
            id={selectId}
            value={count}
            disabled={locked}
            onChange={(e) => setCount(Number(e.target.value))}
            className={COUNT_SELECT_CLASS}
          >
            {countOptions(draft.kind).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
        </div>
      </div>
      <Button
        ref={replanRef}
        type="button"
        variant="secondary"
        className="h-11"
        loading={replanning !== null}
        loadingText={`Re-planning ${slideCount(replanning ?? count)}…`}
        disabled={locked}
        focusableWhenDisabled
        onClick={() => (draft.edited ? setConfirming(true) : onReplan(count))}
      >
        <RotateCw aria-hidden="true" />
        Re-plan
      </Button>
    </div>
  );
}

function ReadyOutline({
  base,
  outline,
  draft,
  replanning,
  replanError,
  starting,
  onBack,
  onGenerate,
}: {
  base: string;
  outline: OutlineController;
  draft: OutlineDraft;
  replanning: number | null;
  replanError: string | null;
  starting: boolean;
  onBack: () => void;
  onGenerate: (approved: ApprovedOutline) => void;
}) {
  const [showProblems, setShowProblems] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const count = draft.points.length;
  const weak = weakCount(draft);
  const unstated = draft.edited ? unstatedFacts(draft) : [];
  const noun = kindNoun(draft.kind);
  const { max } = FRAME_BOUNDS[draft.kind];

  function remove(point: OutlinePoint, index: number) {
    const next = draft.points[index + 1];
    outline.remove(point.id);
    setAnnouncement(
      `Slide ${index + 1} deleted. ${slideCount(count - 1)} in the outline.`,
    );
    if (next) setFocusTarget(fieldId(base, next.id, "title"));
  }

  function add() {
    const id = outline.add();
    if (!id) return;
    setAnnouncement(
      `Slide ${count} added before the last slide. ${slideCount(count + 1)} in the outline.`,
    );
    setFocusTarget(fieldId(base, id, "title"));
  }

  function generate() {
    if (starting) return;
    const problems = draftProblems(draft);
    if (problems.length > 0) {
      setShowProblems(true);
      const first = problems[0];
      setAnnouncement(
        problems.length === 1
          ? "One field needs fixing before you generate."
          : `${problems.length} fields need fixing before you generate.`,
      );
      setFocusTarget(fieldId(base, first.id, first.field));
      return;
    }
    onGenerate(toApproved(draft));
  }

  const action = draft.points[count - 1];
  const before = draft.points.slice(0, count - 1);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div
          data-testid="outline-count-row"
          className="flex flex-wrap items-end justify-between gap-3 pr-8 max-sm:pr-14 [@media(hover:none)]:pr-14"
        >
          <p className="text-[13px] text-[var(--text-secondary)]">
            <span className="font-semibold text-foreground">
              {slideCount(count)}
            </span>
            {weak > 0
              ? ` · ${weak === 1 ? "1 may be weak" : `${weak} may be weak`}. You can still generate.`
              : null}
          </p>
          <CountControl
            base={base}
            draft={draft}
            replanning={replanning}
            locked={starting}
            onReplan={outline.replan}
          />
        </div>
        {replanning !== null ? (
          <p role="status" className="text-[12px] text-[var(--text-muted)]">
            Planning {slideCount(replanning)}. Your outline stays here until the
            new one is ready.
          </p>
        ) : null}
        {replanError ? (
          <p
            role="alert"
            className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[12px] text-[var(--status-error-fg)]"
          >
            {replanError}
          </p>
        ) : null}
        {unstated.length > 0 ? (
          <div
            className="rounded-lg bg-[var(--status-pending-bg)] px-3 py-2 text-[12px] leading-snug text-[var(--status-pending-fg)]"
            data-testid="unstated-facts"
          >
            No slide says {unstated.map((f) => `“${f}”`).join(", ")} any more.
            Add it to a point if the {noun} needs it.
          </div>
        ) : null}
        <ol
          aria-label={`Outline, ${slideCount(count)}`}
          className="flex flex-col gap-2"
        >
          {before.map((point, index) => (
            <PointCard
              key={point.id}
              base={base}
              draft={draft}
              point={point}
              index={index}
              showProblems={showProblems}
              locked={starting}
              onEdit={(field, value) => outline.edit(point.id, field, value)}
              onRemove={() => remove(point, index)}
            />
          ))}
          <li className="list-none">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-center border border-dashed"
              style={{ borderColor: "var(--border-control)" }}
              onClick={add}
              disabled={starting || !canAdd(draft)}
              focusableWhenDisabled
              aria-describedby={canAdd(draft) ? undefined : `${base}-add-limit`}
            >
              <Plus aria-hidden="true" />
              Add a slide before the last
            </Button>
            {canAdd(draft) ? null : (
              <p
                id={`${base}-add-limit`}
                className="mt-1 text-center text-[11px] text-[var(--text-muted)]"
              >
                {max} slides is the most one {noun} can hold.
              </p>
            )}
          </li>
          {action ? (
            <PointCard
              key={action.id}
              base={base}
              draft={draft}
              point={action}
              index={count - 1}
              showProblems={showProblems}
              locked={starting}
              onEdit={(field, value) => outline.edit(action.id, field, value)}
              onRemove={() => {}}
            />
          ) : null}
        </ol>
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
      <Footer>
        <BackButton onBack={onBack} />
        <Button
          type="button"
          onClick={generate}
          loading={starting}
          loadingText="Starting…"
          disabled={replanning !== null}
          focusableWhenDisabled
        >
          <Sparkles aria-hidden="true" />
          {generateLabel(count)}
        </Button>
      </Footer>
    </>
  );
}

export interface OutlineStepProps {
  outline: OutlineController;
  /** The Generate press has been taken and the run is being started. */
  starting: boolean;
  onBack: () => void;
  onGenerate: (approved: ApprovedOutline) => void;
}

export function OutlineStep({
  outline,
  starting,
  onBack,
  onGenerate,
}: OutlineStepProps) {
  const base = useId();
  const { ensure, state, kind } = outline;
  useEffect(() => {
    ensure();
  }, [ensure]);

  return (
    <>
      <Heading kind={kind} />
      {state.status === "ready" ? (
        <ReadyOutline
          base={base}
          outline={outline}
          draft={state.draft}
          replanning={state.replanning}
          replanError={state.replanError}
          starting={starting}
          onBack={onBack}
          onGenerate={onGenerate}
        />
      ) : (
        <>
          {state.status === "error" ? (
            <OutlineProblemPanel
              tone="error"
              title="The outline didn't come through"
              message={state.message}
              onRetry={outline.retry}
            />
          ) : state.status === "empty" ? (
            <OutlineProblemPanel
              tone="empty"
              title="KO found nothing to plan"
              message={`The brief gave KO no points to put on slides. Add what the ${kindNoun(kind)} should say to the brief, or try again.`}
              onRetry={outline.retry}
            />
          ) : (
            <OutlineLoading
              kind={kind}
              count={state.status === "loading" ? state.count : null}
            />
          )}
          <Footer>
            <BackButton onBack={onBack} />
          </Footer>
        </>
      )}
    </>
  );
}
