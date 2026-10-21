import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignGenerationState } from "@/components/design/use-design-generation";
import type { SerializedGeneration } from "@/lib/design/serialize";

const captureEvent = vi.fn();
const normalize = vi.fn();
const upload = vi.fn();

vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: (...a: unknown[]) => captureEvent(...a),
}));
vi.mock("@/lib/uploads/normalize-image", () => ({
  ImageNotUsableError: class extends Error {},
  normalizeImageForUpload: (...a: unknown[]) => normalize(...a),
}));
vi.mock("@/lib/uploads/put-presigned", () => ({
  uploadToPresignedUrl: (...a: unknown[]) => upload(...a),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function runState(): DesignGenerationState {
  return {
    generate: vi.fn(async () => []),
    retry: vi.fn(async () => {}),
    pending: false,
    progressLabel: null,
    stage: null,
    progress: null,
    error: null,
    partial: null,
    failedCount: 0,
    generations: [],
    reset: vi.fn(),
  };
}

/* The dialog runs a second generation of its own for single-slot
   regenerates; this is that one. */
let slotRun: DesignGenerationState;
vi.mock("@/components/design/use-design-generation", () => ({
  useDesignGeneration: () => slotRun,
}));

import { DesignDirectionsDialog } from "./design-directions-dialog";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const KEY = `design-images/${BRAND}/k.png`;

function direction(id: string, title: string): SerializedGeneration {
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
  };
}

function open(design: DesignGenerationState, onOpenChange = vi.fn()) {
  const utils = render(
    <DesignDirectionsDialog
      open
      onOpenChange={onOpenChange}
      entry="calendar"
      args={{ brandId: BRAND, calendarItemId: "item-1" }}
      design={design}
    />,
  );
  return { ...utils, onOpenChange };
}

let uploadDone: () => void;

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
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "https://r2/put", key: KEY }), {
          status: 200,
        }),
    ),
  );
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

const pick = () => new File(["x"], "cake.png", { type: "image/png" });

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
    open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    expect(design.generate).toHaveBeenCalledWith({
      brandId: BRAND,
      calendarItemId: "item-1",
      image: { source: "ko" },
    });
    expect(captureEvent).toHaveBeenCalledWith("design_image_choice", {
      source: "ko",
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

  it("shows the progress steps while the run is pending", async () => {
    const design = runState();
    const { rerender } = open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    rerender(
      <DesignDirectionsDialog
        open
        onOpenChange={vi.fn()}
        entry="calendar"
        args={{ brandId: BRAND }}
        design={{
          ...design,
          pending: true,
          stage: "running",
          progress: { done: 0, total: 3 },
          progressLabel: "Art-directing your design…",
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Art-directing two different directions",
    );
  });

  it("recovers from an unusable image by going back to the drop zone", async () => {
    const design = runState();
    const { rerender } = open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    const failed = { ...design, error: "This image can't be used." };
    rerender(
      <DesignDirectionsDialog
        open
        onOpenChange={vi.fn()}
        entry="calendar"
        args={{ brandId: BRAND }}
        design={failed}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Choose another image" }),
    );
    expect(design.reset).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Choose image" }),
    ).toBeInTheDocument();
  });

  it("regenerates one direction in place and keeps the other", async () => {
    const design = {
      ...runState(),
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    };
    open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    expect(screen.getByRole("article", { name: "Bold" })).toBeInTheDocument();

    vi.mocked(slotRun.generate).mockResolvedValue([
      direction("n1", "Calm"),
      direction("n2", "Airy"),
    ]);
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate direction 1" }),
    );

    /* The fresh direction that is not a twin of the card beside it. */
    expect(await screen.findByRole("article", { name: "Airy" })).toBeVisible();
    expect(screen.getByRole("article", { name: "Calm" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Bold" })).toBeNull();
    expect(slotRun.generate).toHaveBeenCalledWith(
      expect.objectContaining({ image: { source: "ko" } }),
    );
    expect(design.generate).toHaveBeenCalledTimes(1);
  });

  it("keeps the old design and says so when a slot regenerate fails", async () => {
    const design = {
      ...runState(),
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    };
    open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate direction 2" }),
    );
    const calm = within(await screen.findByRole("article", { name: "Calm" }));
    expect(await calm.findByRole("alert")).toHaveTextContent(
      /this design is unchanged/,
    );
  });

  it("closes from Done", async () => {
    const design = {
      ...runState(),
      generations: [direction("d1", "Bold"), direction("d2", "Calm")],
    };
    const { onOpenChange } = open(design);
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
