"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import type { DesignEntry } from "@/components/design/design-analytics";
import type { DirectionSlot } from "@/components/design/directions/direction-results";
import {
  DirectionsFlowView,
  type DirectionsHandlers,
  type DirectionsView,
  dialogWidthFor,
} from "@/components/design/directions/directions-flow-view";
import { FlowChromeProvider } from "@/components/design/directions/flow-heading";
import type { PickedImage } from "@/components/design/directions/use-design-image-upload";
import { GenerateDesignButton } from "@/components/design/generate-design-button";
import { Button } from "@/components/ui/button";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { IMAGE_NOT_USABLE_PREFIX } from "@/lib/uploads/design-image-limits";
import { ImageNotUsableError } from "@/lib/uploads/normalize-image";
import { cn } from "@/lib/utils";
import {
  fixtureGeneration,
  installFakeServer,
  type Scenario,
} from "./fake-server";

const noop = () => {};
const HANDLERS: DirectionsHandlers = {
  onUseOwnImage: noop,
  onLetKoCreate: noop,
  onFile: noop,
  onRemoveImage: noop,
  onRetryUpload: noop,
  onUseImage: noop,
  onBackToChoice: noop,
  onRetryGeneration: noop,
  onChooseAnotherImage: noop,
  onRegenerate: noop,
  onSendToTeam: noop,
  onDone: noop,
};

const IMAGE: PickedImage = {
  name: "strawberry-millefeuille.png",
  bytes: 253_926,
  previewUrl: "/feat-033-preview/upload-cutout.png",
  width: 800,
  height: 800,
};
const PHOTO: PickedImage = {
  name: "counter-shot.jpg",
  bytes: 127_434,
  previewUrl: "/feat-033-preview/upload-photo.jpg",
  width: 1200,
  height: 800,
};

const A = fixtureGeneration(0);
const B = fixtureGeneration(1);
const KO_A = fixtureGeneration(2, { id: "fx-ko-a", imageSource: "ko" });
const KO_B = fixtureGeneration(1, { id: "fx-ko-b", imageSource: "ko" });
/* Points at a file that does not exist, so the card's real onError path
   shows what an expired signed URL looks like. */
const BROKEN: SerializedGeneration = {
  ...fixtureGeneration(1, { id: "fx-broken" }),
  url: "/feat-033-preview/expired-signed-url.png",
};

const slot = (g: SerializedGeneration): DirectionSlot => ({
  id: g.id,
  generation: g,
});
const failed = (id: string): DirectionSlot => ({ id, generation: null });

const RESULTS = {
  step: "results" as const,
  source: "upload" as const,
  imageName: IMAGE.name,
  regeneratingSlot: null,
  regenerateError: null,
  sendingId: null,
};

/* The exact strings the server and the browser produce, so the harness
   cannot hide a formatting bug behind a hand-written sentence. */
const SERVER_UNUSABLE = `${IMAGE_NOT_USABLE_PREFIX}: it is not a PNG or JPEG file. Choose another image.`;
const BROWSER_UNUSABLE = new ImageNotUsableError("undecodable").message;

function progress(
  source: "upload" | "ko",
  jobStage: Extract<DirectionsView, { step: "progress" }>["jobStage"],
  extra: Partial<Extract<DirectionsView, { step: "progress" }>> = {},
): DirectionsView {
  return {
    step: "progress",
    source,
    stage: jobStage ? "running" : "starting",
    jobStage,
    progress: null,
    label: jobStage ? null : "Starting…",
    ...extra,
  };
}

const STATES: { title: string; entry?: DesignEntry; view: DirectionsView }[] = [
  { title: "Choice (calendar post)", view: { step: "choose" } },
  {
    title: "Choice (design brief or Design Studio)",
    entry: "brief",
    view: { step: "choose" },
  },
  {
    title: "Drop zone, empty",
    view: {
      step: "upload",
      upload: { status: "idle", rejection: null },
      waitingOnUpload: false,
    },
  },
  {
    title: "Drop zone, drag over",
    view: {
      step: "upload",
      upload: { status: "idle", rejection: null },
      waitingOnUpload: false,
      dragActive: true,
    },
  },
  {
    title: "Drop zone, file refused before upload",
    view: {
      step: "upload",
      upload: {
        status: "idle",
        rejection: "menu.heic isn't a PNG, JPEG or WEBP. Choose one of those.",
      },
      waitingOnUpload: false,
    },
  },
  {
    title: "Preparing (normalising in the browser)",
    view: {
      step: "upload",
      upload: { status: "preparing", image: PHOTO },
      waitingOnUpload: false,
    },
  },
  {
    title: "Uploading",
    view: {
      step: "upload",
      upload: { status: "uploading", image: IMAGE, fraction: 0.46 },
      waitingOnUpload: false,
    },
  },
  {
    title: "Uploading, Use this image already pressed",
    view: {
      step: "upload",
      upload: { status: "uploading", image: IMAGE, fraction: 0.82 },
      waitingOnUpload: true,
    },
  },
  {
    title: "Preview, ready",
    view: {
      step: "upload",
      upload: { status: "ready", image: IMAGE, key: "design-images/x/y.png" },
      waitingOnUpload: false,
    },
  },
  {
    title: "Upload error (transport, retryable)",
    view: {
      step: "upload",
      upload: {
        status: "error",
        image: IMAGE,
        step: "upload",
        message:
          "The upload didn't finish. Check your connection and try again.",
      },
      waitingOnUpload: false,
    },
  },
  {
    title: "Upload error (browser: image can't be used, real message)",
    view: {
      step: "upload",
      upload: {
        status: "error",
        image: PHOTO,
        step: "prepare",
        message: BROWSER_UNUSABLE,
      },
      waitingOnUpload: false,
    },
  },
  { title: "Progress, KO: starting", view: progress("ko", null) },
  {
    title: "Progress, KO: stage brief",
    view: progress("ko", "brief", { label: "Writing the directions…" }),
  },
  {
    title: "Progress, KO: stage imagery",
    view: progress("ko", "imagery", { label: "Creating imagery…" }),
  },
  {
    title: "Progress, KO: stage render (1 of 2)",
    view: progress("ko", "render", {
      progress: { done: 1, total: 2 },
      label: "Rendering designs…",
    }),
  },
  {
    title: "Progress, KO: stage checks",
    view: progress("ko", "checks", { label: "Running brand checks…" }),
  },
  {
    title: "Progress, KO: reading the finished designs",
    view: progress("ko", "checks", {
      stage: "fetching",
      label: "Getting your designs ready…",
    }),
  },
  {
    title: "Progress, upload: stage brief (no imagery step)",
    view: progress("upload", "brief", { label: "Writing the directions…" }),
  },
  {
    title: "Progress, upload: stage render (0 of 2)",
    view: progress("upload", "render", {
      progress: { done: 0, total: 2 },
      label: "Rendering designs…",
    }),
  },
  {
    title: "Progress, upload: stage checks",
    view: progress("upload", "checks", { label: "Running brand checks…" }),
  },
  {
    title: "Error: server says the image can't be used (real format)",
    view: {
      step: "error",
      source: "upload",
      message: SERVER_UNUSABLE,
      unusableImage: true,
    },
  },
  {
    title: "Error: any other failure",
    view: {
      step: "error",
      source: "ko",
      message: "Design generation failed. Please try again.",
      unusableImage: false,
    },
  },
  {
    title: "Results, your image",
    view: { ...RESULTS, slots: [slot(A), slot(B)] },
  },
  {
    title: "Results, KO imagery",
    view: {
      ...RESULTS,
      source: "ko",
      imageName: null,
      slots: [slot(KO_A), slot(KO_B)],
    },
  },
  {
    title: "Results, direction 1 regenerating (the other stays usable)",
    view: { ...RESULTS, slots: [slot(A), slot(B)], regeneratingSlot: 0 },
  },
  {
    title: "Results, direction 2 sending to the design team",
    view: { ...RESULTS, slots: [slot(A), slot(B)], sendingId: B.id },
  },
  {
    title: "Results, preview unavailable (image failed to load)",
    view: { ...RESULTS, slots: [slot(A), slot(BROKEN)] },
  },
  {
    title: "Results, 1 of 2 failed",
    view: { ...RESULTS, slots: [slot(A), failed("fx-failed")] },
  },
  {
    title: "Results, failed direction regenerating",
    view: {
      ...RESULTS,
      slots: [slot(A), failed("fx-failed")],
      regeneratingSlot: 1,
    },
  },
  {
    title: "Results, a slot regenerate failed",
    view: {
      ...RESULTS,
      slots: [slot(A), slot(B)],
      regenerateError: {
        slot: 1,
        message:
          "Regenerating didn't work, so this design is unchanged. Try again.",
      },
    },
  },
  { title: "Results, empty", view: { ...RESULTS, slots: [] } },
];

function slug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function Frame({
  title,
  entry = "calendar",
  view,
}: {
  title: string;
  entry?: DesignEntry;
  view: DirectionsView;
}) {
  const wide = view.step === "results";
  return (
    <section
      data-state={slug(title)}
      className={cn("flex min-w-0 flex-col gap-2", wide && "lg:col-span-2")}
    >
      <h2 className="text-[12px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {title}
      </h2>
      {/* Mirrors DialogContent's surface so a state reads as it does in the
          modal, without an open modal per state. */}
      <div
        className={cn(
          "w-full rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10",
          dialogWidthFor(view).replace("sm:", ""),
        )}
      >
        <FlowChromeProvider value="static">
          <DirectionsFlowView entry={entry} view={view} handlers={HANDLERS} />
        </FlowChromeProvider>
      </div>
    </section>
  );
}

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "ok", label: "Two directions" },
  { value: "one-failed", label: "One fails" },
  { value: "unusable", label: "Upload is unusable" },
  { value: "legacy", label: "Legacy rows" },
];

/* The real entry point against the fake server: every click goes through
   GenerateDesignButton, useDesignGeneration, the upload hook and
   pollGenerationJob exactly as in the app. */
function LiveFlow() {
  const [scenario, setScenario] = useState<Scenario>("ok");
  const current = useRef(scenario);
  current.current = scenario;

  useEffect(() => installFakeServer(() => current.current), []);

  return (
    <section className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <h2 className="text-[12px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        Live: the real button and dialog against a fake server
      </h2>
      <p className="text-[13px] text-[var(--text-secondary)]">
        Each job poll advances one stage (about 3 s apart). Regenerate sends
        regenerateOf and gets one direction back. Send to design team answers
        after 1.5 s.
      </p>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Scenario</legend>
        {SCENARIOS.map((s) => (
          <Button
            key={s.value}
            type="button"
            variant={scenario === s.value ? "default" : "secondary"}
            aria-pressed={scenario === s.value}
            onClick={() => setScenario(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <GenerateDesignButton
          brandId="00000000-0000-4000-8000-000000000000"
          calendarItemId="00000000-0000-4000-8000-000000000001"
          label="Generate with AI (calendar)"
          size="lg"
          ticketContext={{
            calendarItemId: "00000000-0000-4000-8000-000000000001",
            designType: "Instagram post",
            dimensions: "1080x1350",
            brief: "Launch the strawberry millefeuille",
          }}
        />
        <GenerateDesignButton
          brandId="00000000-0000-4000-8000-000000000000"
          briefId="00000000-0000-4000-8000-000000000002"
          label="Generate Design (brief panel)"
          variant="secondary"
          size="lg"
        />
      </div>
    </section>
  );
}

export function PreviewClient() {
  const { setTheme } = useTheme();
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold text-foreground">
            FEAT-033 image directions: every state
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Temporary review harness with fixture data. Not shipped.
          </p>
        </div>
        {/* Fixed labels: the resolved theme is unknown during SSR, so a label
            derived from it would mismatch on hydration. */}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setTheme("light")}>
            Light
          </Button>
          <Button variant="secondary" onClick={() => setTheme("dark")}>
            Dark
          </Button>
        </div>
      </header>
      <LiveFlow />
      <div className="grid items-start gap-x-8 gap-y-10 lg:grid-cols-2">
        {STATES.map((state) => (
          <Frame key={state.title} {...state} />
        ))}
      </div>
    </main>
  );
}
