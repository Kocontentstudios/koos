import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesignGenerationState,
  GenerateArgs,
} from "@/components/design/use-design-generation";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { withKoImagery } from "@/lib/testing/ko-imagery";
import { DesignImageError } from "@/lib/uploads/design-image";

const captureEvent = vi.fn();
const normalize = vi.fn();
const upload = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: (...a: unknown[]) => captureEvent(...a),
}));
vi.mock("@/lib/uploads/normalize-image", async (original) => ({
  ...(await original<typeof import("@/lib/uploads/normalize-image")>()),
  normalizeImageForUpload: (...a: unknown[]) => normalize(...a),
}));
vi.mock("@/lib/uploads/put-presigned", () => ({
  uploadToPresignedUrl: (...a: unknown[]) => upload(...a),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
  },
}));

function runState(
  overrides: Partial<DesignGenerationState> = {},
): DesignGenerationState {
  return {
    generate: vi.fn(async () => []),
    retry: vi.fn(async () => {}),
    pending: false,
    progressLabel: null,
    stage: null,
    progress: null,
    jobStage: null,
    error: null,
    partial: null,
    failedCount: 0,
    failedIds: [],
    generations: [],
    reset: vi.fn(),
    ...overrides,
  };
}

/* The dialog runs a second generation of its own for single-slot
   regenerates; this is that one. Its server side (regenerateOf) lands in a
   later unit, so it is mocked here to the contract: one generation back. */
let slotRun: DesignGenerationState;
vi.mock("@/components/design/use-design-generation", () => ({
  useDesignGeneration: () => slotRun,
}));

import { DesignDirectionsDialog } from "./design-directions-dialog";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const KEY = `design-images/${BRAND}/k.png`;
const TICKET = {
  calendarItemId: "item-1",
  designType: "Instagram post",
  dimensions: "1080x1350",
  brief: "Launch the strawberry millefeuille",
};

function direction(
  id: string,
  title: string,
  overrides: Partial<SerializedGeneration> = {},
): SerializedGeneration {
  return {
    id,
    url: `https://r2/${id}.png`,
    renderer: "composite",
    provider: "composite",
    model: "satori",
    status: "succeeded",
    error: null,
    width: 1080,
    height: 1350,
    designType: null,
    briefId: null,
    calendarItemId: null,
    headline: null,
    createdAt: "2026-10-21T00:00:00.000Z",
    direction: { title, reasons: ["r"] },
    imageSource: "ko",
    editable: true,
    ...overrides,
  };
}

function dialog(design: DesignGenerationState, onOpenChange = vi.fn()) {
  return (
    <DesignDirectionsDialog
      open
      onOpenChange={onOpenChange}
      entry="calendar"
      args={{ brandId: BRAND, calendarItemId: "item-1" }}
      design={design}
      ticketContext={TICKET}
    />
  );
}

function open(
  design: DesignGenerationState,
  onOpenChange = vi.fn(),
  koImagery = true,
) {
  const utils = render(dialog(design, onOpenChange), withKoImagery(koImagery));
  return { ...utils, onOpenChange };
}

/** Opens with KO imagery chosen, so the results of `design` are on screen. */
async function openResults(design: DesignGenerationState) {
  const utils = open(design);
  await userEvent.click(
    screen.getByRole("button", { name: /let ko create the imagery/i }),
  );
  return utils;
}

let uploadDone: () => void;
let ticketDone: (res: Response) => void;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  slotRun = runState();
  normalize.mockResolvedValue({
    blob: new Blob(["png"], { type: "image/png" }),
    type: "image/png",
    width: 1200,
    height: 1200,
  });
  upload.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        uploadDone = resolve;
      }),
  );
  fetchMock = vi.fn((url: string) =>
    String(url).includes("/api/design-tickets")
      ? new Promise<Response>((resolve) => {
          ticketDone = resolve;
        })
      : Promise.resolve(
          new Response(
            JSON.stringify({
              url: "https://r2/put",
              key: KEY,
              contentType: "image/png",
            }),
            { status: 200 },
          ),
        ),
  );
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

const pick = () => new File(["x"], "cake.png", { type: "image/png" });

/* Oluwaseyi's ruling, 2026-10-27: the UI must not offer KO imagery while
   FEATURE_KO_IMAGERY is off. The only choices are the client's upload and a
   text-led design with no image, on every screen of the dialog. */
describe("DesignDirectionsDialog with FEATURE_KO_IMAGERY off", () => {
  const koRequests = (design: DesignGenerationState) =>
    vi
      .mocked(design.generate)
      .mock.calls.filter(
        ([args]) => (args as GenerateArgs).image?.source === "ko",
      );

  it("offers the upload and no image, and nothing that names KO imagery", () => {
    open(runState(), vi.fn(), false);
    const dialogEl = screen.getByRole("dialog");
    expect(
      within(dialogEl).getByRole("button", { name: /use a specific image/i }),
    ).toBeInTheDocument();
    expect(
      within(dialogEl).getByRole("button", {
        name: /design without an image/i,
      }),
    ).toBeInTheDocument();
    expect(dialogEl).not.toHaveTextContent(/let ko create|ko imagery/i);
  });

  it("generates a text-led pair with no image and records the choice", async () => {
    const design = runState();
    const { rerender } = open(design, vi.fn(), false);
    await userEvent.click(
      screen.getByRole("button", { name: /design without an image/i }),
    );
    expect(design.generate).toHaveBeenCalledWith({
      brandId: BRAND,
      calendarItemId: "item-1",
      image: { source: "none" },
    });
    expect(captureEvent).toHaveBeenCalledWith("design_image_choice", {
      source: "none",
      entry: "calendar",
    });

    rerender(
      dialog({
        ...design,
        pending: true,
        stage: "running",
        jobStage: "render",
        progress: { done: 0, total: 2 },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Laying out both designs around your words.*, step 2 of 3$/,
    );
  });

  it("offers no image, not KO imagery, as the way out of an unusable image", async () => {
    const design = runState();
    const { rerender } = open(design, vi.fn(), false);
    await userEvent.click(
      screen.getByRole("button", { name: /design without an image/i }),
    );
    vi.mocked(design.generate).mockClear();
    rerender(
      dialog({
        ...design,
        error: new DesignImageError("not_png_or_jpeg").message,
      }),
    );
    const alert = screen.getByRole("alert");
    expect(
      within(alert).queryByRole("button", { name: /let ko create/i }),
    ).toBeNull();
    await userEvent.click(
      within(alert).getByRole("button", { name: "Design without an image" }),
    );
    expect(design.generate).toHaveBeenCalledWith(
      expect.objectContaining({ image: { source: "none" } }),
    );
  });

  /* Every control on every screen reachable without a server is pressed,
     each on a fresh dialog so one press cannot hide the next; not one of
     them may produce a request with source "ko". */
  it("cannot produce a KO-imagery request from any control", async () => {
    const design = runState();
    const buttons = () =>
      within(screen.getByRole("dialog")).getAllByRole("button");
    const choose = async () => open(design, vi.fn(), false);
    const failed = (error: string) => async () => {
      const utils = open(design, vi.fn(), false);
      await userEvent.click(
        screen.getByRole("button", { name: /design without an image/i }),
      );
      utils.rerender(dialog({ ...design, error }));
      return utils;
    };
    const screens = [
      choose,
      failed(new DesignImageError("not_png_or_jpeg").message),
      failed("The job timed out."),
    ];
    let pressed = 0;
    for (const reach of screens) {
      const first = await reach();
      const count = buttons().length;
      first.unmount();
      for (let i = 0; i < count; i++) {
        const utils = await reach();
        await userEvent.click(buttons()[i]);
        pressed++;
        utils.unmount();
      }
    }
    expect(pressed).toBeGreaterThanOrEqual(8);
    expect(design.generate).toHaveBeenCalled();
    expect(koRequests(design)).toEqual([]);
  });
});

describe("DesignDirectionsDialog", () => {
  it("starts with the image choice and nothing generated", () => {
    const design = runState();
    open(design);
    expect(
      screen.getByRole("heading", { name: "Choose the image for this post" }),
    ).toBeInTheDocument();
    expect(design.generate).not.toHaveBeenCalled();
  });

  it("generates with KO imagery in one click and records the choice", async () => {
    const design = runState();
    await openResults(design);
    expect(design.generate).toHaveBeenCalledWith({
      brandId: BRAND,
      calendarItemId: "item-1",
      image: { source: "ko" },
    });
    expect(captureEvent).toHaveBeenCalledWith("design_image_choice", {
      source: "ko",
      entry: "calendar",
    });
  });

  it("uploads, previews and generates around the stored key", async () => {
    const design = runState();
    open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /use a specific image/i }),
    );
    await userEvent.upload(screen.getByTestId("design-image-input"), pick());

    expect(
      await screen.findByRole("img", { name: /cake\.png/ }),
    ).toBeInTheDocument();
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0][3]).toBe("image/png");
    uploadDone();
    await screen.findByText(/Ready to use/);

    await userEvent.click(
      screen.getByRole("button", { name: /use this image/i }),
    );
    expect(design.generate).toHaveBeenCalledWith(
      expect.objectContaining({ image: { source: "upload", key: KEY } }),
    );
    expect(captureEvent).toHaveBeenCalledWith("design_image_choice", {
      source: "upload",
      entry: "calendar",
    });
  });

  /* Pressing "Use this image" while the bytes are still moving must not be
     wasted: the run starts by itself the moment the upload lands. */
  it("continues on its own when Use this image was pressed mid-upload", async () => {
    const design = runState();
    open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /use a specific image/i }),
    );
    await userEvent.upload(screen.getByTestId("design-image-input"), pick());
    await waitFor(() => expect(upload).toHaveBeenCalled());

    await userEvent.click(
      screen.getByRole("button", { name: /use this image/i }),
    );
    expect(
      screen.getByRole("button", { name: /finishing upload/i }),
    ).toHaveAttribute("aria-busy", "true");
    expect(design.generate).not.toHaveBeenCalled();

    uploadDone();
    await waitFor(() =>
      expect(design.generate).toHaveBeenCalledWith(
        expect.objectContaining({ image: { source: "upload", key: KEY } }),
      ),
    );
  });

  it("goes back to the choice from the upload step", async () => {
    open(runState());
    await userEvent.click(
      screen.getByRole("button", { name: /use a specific image/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(
      screen.getByRole("heading", { name: "Choose the image for this post" }),
    ).toBeInTheDocument();
  });

  it("steps the progress on the job's stage", async () => {
    const design = runState();
    const { rerender } = await openResults(design);
    rerender(
      dialog({
        ...design,
        pending: true,
        stage: "running",
        jobStage: "imagery",
        progress: { done: 0, total: 2 },
        progressLabel: "Painting the plates…",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Creating imagery for each direction, step 2 of 4",
    );
  });

  /* The real server format, with its colon: an earlier build only matched a
     hand-written full-stop sentence and showed the colon to the user. */
  it("recovers from the server's real unusable-image error", async () => {
    const design = runState();
    const { rerender } = await openResults(design);
    rerender(
      dialog({
        ...design,
        error: new DesignImageError("not_png_or_jpeg").message,
      }),
    );
    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "This image can't be used" }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent("It is not a PNG or JPEG file.");
    expect(alert.textContent?.match(/choose another image/gi)).toHaveLength(1);
    expect(
      within(alert).queryByRole("button", { name: /try again/i }),
    ).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Choose another image" }),
    );
    expect(design.reset).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Choose image" }),
    ).toBeInTheDocument();
  });

  it("regenerates one direction by id and swaps exactly that slot", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    await openResults(design);
    expect(screen.getByRole("article", { name: "Bold" })).toBeInTheDocument();

    vi.mocked(slotRun.generate).mockResolvedValue([direction("n1", "Airy")]);
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate direction 1" }),
    );

    expect(slotRun.generate).toHaveBeenCalledWith({
      brandId: BRAND,
      calendarItemId: "item-1",
      image: { source: "ko" },
      regenerateOf: "d1",
    });
    const articles = await screen.findAllByRole("article");
    expect(articles.map((a) => a.getAttribute("aria-labelledby"))).toEqual([
      "direction-n1",
      "direction-d2",
    ]);
    expect(screen.queryByRole("article", { name: "Bold" })).toBeNull();
    expect(design.generate).toHaveBeenCalledTimes(1);
    /* Not a new choice: the funnel counts each decision once. */
    expect(
      captureEvent.mock.calls.filter(([e]) => e === "design_image_choice"),
    ).toHaveLength(1);
  });

  /* A replaced slot regenerates from the design now in it, not the one it
     replaced. */
  it("regenerates a replaced slot from its current design", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    await openResults(design);
    vi.mocked(slotRun.generate)
      .mockResolvedValueOnce([direction("n1", "Airy")])
      .mockResolvedValueOnce([direction("n2", "Crisp")]);
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate direction 1" }),
    );
    await screen.findByRole("article", { name: "Airy" });
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate direction 1" }),
    );
    expect(await screen.findByRole("article", { name: "Crisp" })).toBeVisible();
    expect(vi.mocked(slotRun.generate).mock.calls[1][0]).toMatchObject({
      regenerateOf: "n1",
    });
  });

  it("regenerates a failed direction by its own row id", async () => {
    const design = runState({
      generations: [direction("d1", "Bold")],
      failedIds: ["f2"],
      failedCount: 1,
    });
    await openResults(design);
    vi.mocked(slotRun.generate).mockResolvedValue([direction("n2", "Calm")]);
    await userEvent.click(
      within(
        screen.getByRole("article", { name: "Direction 2 did not render" }),
      ).getByRole("button", { name: "Regenerate direction 2" }),
    );
    expect(vi.mocked(slotRun.generate).mock.calls[0][0]).toMatchObject({
      regenerateOf: "f2",
    });
    expect(await screen.findByRole("article", { name: "Calm" })).toBeVisible();
    expect(screen.getByRole("article", { name: "Bold" })).toBeVisible();
  });

  it("keeps the old design and says so when a slot regenerate fails", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    await openResults(design);
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate direction 2" }),
    );
    const calm = within(await screen.findByRole("article", { name: "Calm" }));
    expect(await calm.findByRole("alert")).toHaveTextContent(
      /this design is unchanged/,
    );
  });

  /* The contract is one row per regenerate. Round 2 took the first row of
     whatever came back, so a server that returned two would have swapped one
     in silently and left the other unexplained. */
  it.each([
    ["no rows", []],
    ["two rows", [direction("n1", "Airy"), direction("n2", "Crisp")]],
  ])("treats %s from a regenerate as a failure", async (_label, rows) => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    await openResults(design);
    vi.mocked(slotRun.generate).mockResolvedValue(rows);
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate direction 1" }),
    );
    const bold = within(await screen.findByRole("article", { name: "Bold" }));
    expect(await bold.findByRole("alert")).toHaveTextContent(
      "Regenerating didn't work, so this design is unchanged. Try again.",
    );
    expect(screen.queryByRole("article", { name: "Airy" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Crisp" })).toBeNull();
    expect(
      screen
        .getAllByRole("article")
        .map((a) => a.getAttribute("aria-labelledby")),
    ).toEqual(["direction-d1", "direction-d2"]);
  });

  /* No image was chosen on a KO-imagery run, so "Change image" named
     something that never happened. And leaving results cleared both designs
     from the dialog with no word that they are kept. */
  it("asks before starting over from results, and says the designs are kept", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    await openResults(design);
    expect(screen.queryByRole("button", { name: /change image/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(design.reset).not.toHaveBeenCalled();
    const prompt = screen.getByRole("group", {
      name: "Start over? These designs stay in Design Studio.",
    });
    const stay = within(prompt).getByRole("button", { name: "Stay here" });
    expect(stay).toHaveFocus();

    await userEvent.click(stay);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByRole("button", { name: "Start over" })).toHaveFocus();
    expect(screen.getByRole("article", { name: "Bold" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    await userEvent.click(
      within(screen.getByRole("group")).getByRole("button", {
        name: "Start over",
      }),
    );
    expect(design.reset).toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Choose the image for this post" }),
    ).toBeInTheDocument();
  });

  /* Escape with the confirm open closed the whole dialog: innermost first. */
  it("dismisses only the start-over confirm on Escape, then the dialog", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    const { onOpenChange } = await openResults(design);

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(
      within(screen.getByRole("group")).getByRole("button", {
        name: "Stay here",
      }),
    ).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(design.reset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start over" })).toHaveFocus();
    expect(screen.getByRole("article", { name: "Bold" })).toBeVisible();

    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls it Change image after a run built around an upload", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /use a specific image/i }),
    );
    await userEvent.upload(screen.getByTestId("design-image-input"), pick());
    await waitFor(() => expect(upload).toHaveBeenCalled());
    uploadDone();
    await screen.findByText(/Ready to use/);
    await userEvent.click(
      screen.getByRole("button", { name: /use this image/i }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Change image" }));
    expect(
      screen.getByRole("group", {
        name: "Change image? These designs stay in Design Studio.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
  });

  /* With nothing rendered there is nothing to lose, so no confirm. */
  it("starts over straight away when no design is on screen", async () => {
    const design = runState({ failedIds: ["f1", "f2"], failedCount: 2 });
    await openResults(design);
    expect(
      screen.getByRole("heading", { name: "Neither direction rendered" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(design.reset).toHaveBeenCalled();
  });

  /* Round 2 kept "Two directions to choose from" over one design and one
     failed slot. */
  it("heads the results with what actually came back", async () => {
    const design = runState({
      generations: [direction("d1", "Bold")],
      failedIds: ["f2"],
      failedCount: 1,
    });
    await openResults(design);
    expect(
      screen.getByRole("heading", { name: "One direction is ready" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Two directions to choose from")).toBeNull();
  });

  it("sends one direction to the design team with the entry's context", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    await openResults(design);
    await userEvent.click(
      within(screen.getByRole("article", { name: "Calm" })).getByRole(
        "button",
        { name: /send to design team/i },
      ),
    );

    /* Pending on that card only. */
    expect(
      within(screen.getByRole("article", { name: "Calm" })).getByRole(
        "button",
        { name: "Sending…" },
      ),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      within(screen.getByRole("article", { name: "Bold" })).getByRole(
        "button",
        { name: /send to design team/i },
      ),
    ).toBeEnabled();

    const [url, init] = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/api/design-tickets"),
    ) as [string, RequestInit];
    expect(url).toBe("/api/design-tickets");
    expect(JSON.parse(String(init.body))).toMatchObject({
      brandId: BRAND,
      generationId: "d2",
      referenceImageUrl: "https://r2/d2.png",
      ...TICKET,
    });

    ticketDone(
      new Response(JSON.stringify({ ticket: { ticketNumber: 42 } }), {
        status: 200,
      }),
    );
    const calm = within(screen.getByRole("article", { name: "Calm" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("article", { name: "Calm" })
          .querySelector("[data-slot=sent-notice]"),
      ).toHaveTextContent("Sent to the design team as DT-42"),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(
      calm.getByRole("button", { name: /sent to design team/i }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(screen.getByRole("article", { name: "Bold" })).getByRole(
        "button",
        { name: /send to design team/i },
      ),
    ).toBeEnabled();
  });

  it("says on the card when sending fails, and clears it on a retry", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    await openResults(design);
    const calm = () => within(screen.getByRole("article", { name: "Calm" }));
    await userEvent.click(
      calm().getByRole("button", { name: /send to design team/i }),
    );
    ticketDone(
      new Response(JSON.stringify({ error: "The design team is offline." }), {
        status: 500,
      }),
    );
    expect(await calm().findByRole("alert")).toHaveTextContent(
      "The design team is offline.",
    );
    expect(toastError).not.toHaveBeenCalled();

    await userEvent.click(
      calm().getByRole("button", { name: /send to design team/i }),
    );
    expect(calm().queryByRole("alert")).toBeNull();
  });

  /* Rows from before directions (or a server that has not shipped them yet)
     have no title or reasons, so they keep the preview they always had. */
  it("opens the legacy preview for rows without a direction", async () => {
    const design = runState({
      generations: [direction("old", "x", { direction: null })],
    });
    await openResults(design);
    expect(
      screen.getByRole("heading", { name: "Generated design" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
    expect(
      screen.getByRole("button", { name: /send to design team/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(design.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({ image: { source: "ko" } }),
    );
  });

  it("closes from Done", async () => {
    const design = runState({
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    });
    const { onOpenChange } = open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
