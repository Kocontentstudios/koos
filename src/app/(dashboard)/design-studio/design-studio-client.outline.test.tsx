import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KoImageryProvider } from "@/components/design/directions/ko-imagery-context";
import { MultiFrameProvider } from "@/components/design/directions/multi-frame-context";
import { BRAND, plannedOutline } from "@/components/design/sequence/fixtures";
import type { ContextOption } from "@/lib/design/context-search";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { DesignStudioClient } from "./design-studio-client";

const design = {
  pending: false,
  posting: false,
  progressLabel: null,
  stage: null,
  progress: null,
  jobStage: null,
  error: null,
  stillRunning: false,
  partial: null,
  failedCount: 0,
  failedIds: [] as string[],
  generations: [] as SerializedGeneration[],
  set: null,
  sequenceProgress: null,
  regenerateFrame: vi.fn(async () => null),
  keepWaitingOnFrame: vi.fn(async () => null),
  frameActions: new Set<string>(),
  frameErrors: {},
  framesStillRunning: new Set<number>(),
  generate: vi.fn(async () => []),
  retry: vi.fn(),
  reset: vi.fn(),
};

vi.mock("@/components/design/use-design-generation", () => ({
  useDesignGeneration: () => design,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/analytics/posthog-client", () => ({ captureEvent: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/* The real picker fetches the brand's context; this stands in for a user
   choosing options, with the designType the context route now carries. */
const PICKS: Record<string, ContextOption[]> = {
  "Attach carousel brief": [
    {
      type: "brief",
      id: "brief-c",
      label: "Linen launch",
      hint: "Instagram carousel",
      designType: "Instagram carousel",
    },
  ],
  "Attach single post brief": [
    {
      type: "brief",
      id: "brief-s",
      label: "Opening hours",
      hint: "Instagram post",
      designType: "Instagram post",
    },
  ],
  /* A brief outranks a calendar item, as it does when the server merges
     them, so the deck brief decides the format. */
  "Attach deck brief and a post slot": [
    {
      type: "calendar_item",
      id: "item-1",
      label: "Saturday post",
      hint: null,
      designType: "Instagram post",
    },
    {
      type: "brief",
      id: "brief-d",
      label: "Investor deck",
      hint: "Presentation",
      designType: "Presentation",
    },
  ],
};

vi.mock("./context-picker", () => ({
  ContextPicker: ({
    onChange,
  }: {
    onChange: (next: ContextOption[]) => void;
  }) => (
    <div>
      {Object.entries(PICKS).map(([label, options]) => (
        <button key={label} type="button" onClick={() => onChange(options)}>
          {label}
        </button>
      ))}
    </div>
  ),
  toAttachmentRefs: (selected: ContextOption[]) =>
    selected.map(({ type, id }) => ({ type, id })),
}));

const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url === "/api/design/outline") {
    const body = JSON.parse(String(_init?.body)) as { attachments?: unknown };
    const kind = JSON.stringify(body.attachments).includes("brief-d")
      ? "presentation"
      : "carousel";
    return Response.json({ outline: plannedOutline(5, kind) });
  }
  return Response.json({ jobs: [], generations: [] });
});

const outlineCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/design/outline");

function renderStudio(multiFrame: boolean) {
  return render(
    <DesignStudioClient
      brandId={BRAND}
      brandName="Lagos Loom"
      initialGenerations={[]}
    />,
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <KoImageryProvider enabled>
          <MultiFrameProvider enabled={multiFrame}>
            {children}
          </MultiFrameProvider>
        </KoImageryProvider>
      ),
    },
  );
}

async function startWith(pick: string) {
  await userEvent.click(screen.getByRole("button", { name: pick }));
  await userEvent.click(
    screen.getByRole("button", { name: /Generate Design/ }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /let ko create the imagery/i }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Design Studio's outline step", () => {
  it("stops an attached carousel brief at its outline, then generates from the approved one", async () => {
    renderStudio(true);
    await startWith("Attach carousel brief");

    const outline = await screen.findByRole("list", { name: /^Outline/ });
    expect(within(outline).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(design.generate).not.toHaveBeenCalled();
    expect(outlineCalls()).toHaveLength(1);
    expect(JSON.parse(String(outlineCalls()[0][1]?.body))).toMatchObject({
      brandId: BRAND,
      attachments: [{ type: "brief", id: "brief-c" }],
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Generate 5 slides · 5 units" }),
    );
    expect(design.generate).toHaveBeenCalledTimes(1);
    const [args, options] = design.generate.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { sequenceKind: string },
    ];
    expect(args).toMatchObject({
      brandId: BRAND,
      attachments: [{ type: "brief", id: "brief-c" }],
      image: { source: "ko" },
      approvedOutline: { kind: "carousel" },
    });
    expect((args.approvedOutline as { points: unknown[] }).points).toHaveLength(
      5,
    );
    expect(options).toEqual({ sequenceKind: "carousel" });
  });

  it("reads the format by the server's precedence when several things are attached", async () => {
    renderStudio(true);
    await startWith("Attach deck brief and a post slot");
    await screen.findByRole("list", { name: /^Outline/ });
    expect(screen.getByText(/Plan your presentation/)).toBeInTheDocument();
  });

  it("goes straight to the run for a single-design brief", async () => {
    renderStudio(true);
    await startWith("Attach single post brief");
    expect(design.generate).toHaveBeenCalledTimes(1);
    expect(design.generate.mock.calls[0]).toHaveLength(1);
    expect(outlineCalls()).toHaveLength(0);
  });

  it("asks for no outline with FEATURE_MULTI_FRAME off", async () => {
    renderStudio(false);
    await startWith("Attach carousel brief");
    expect(design.generate).toHaveBeenCalledTimes(1);
    expect(outlineCalls()).toHaveLength(0);
    expect(
      screen.queryByRole("list", { name: /^Outline/ }),
    ).not.toBeInTheDocument();
  });
});
