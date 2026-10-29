import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SerializedGeneration } from "@/lib/design/serialize";

const captureEvent = vi.fn();
const pngToJpeg = vi.fn();
const saveBlob = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: (...a: unknown[]) => captureEvent(...a),
}));
vi.mock("@/lib/design/png-to-jpeg", async (original) => ({
  ...(await original<typeof import("@/lib/design/png-to-jpeg")>()),
  pngToJpeg: (...a: unknown[]) => pngToJpeg(...a),
  saveBlob: (...a: unknown[]) => saveBlob(...a),
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

import {
  DirectionResults,
  type DirectionResultsProps,
  type DirectionSlot,
} from "./direction-results";

function direction(
  id: string,
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
    designType: "Instagram post",
    briefId: null,
    calendarItemId: null,
    headline: "Make today sweeter",
    createdAt: "2026-10-21T00:00:00.000Z",
    direction: {
      title: id === "d1" ? "Playful product story" : "Editorial arch frame",
      reasons: ["Cutout sits on a warm arch", "Headline leads the eye"],
    },
    imageSource: "upload",
    editable: true,
    ...overrides,
  };
}

const ready = (generation: SerializedGeneration): DirectionSlot => ({
  id: generation.id,
  generation,
});
const failedSlot = (id: string): DirectionSlot => ({ id, generation: null });

function results(overrides: Partial<DirectionResultsProps> = {}) {
  const props: DirectionResultsProps = {
    slots: [ready(direction("d1")), ready(direction("d2"))],
    source: "upload",
    imageName: "cake.png",
    regeneratingSlot: null,
    regenerateError: null,
    sendingId: null,
    onRegenerate: vi.fn(),
    onSendToTeam: vi.fn(),
    onChooseImagery: vi.fn(),
    ...overrides,
  };
  const utils = render(<DirectionResults {...props} />);
  return { props, ...utils };
}

const card = (title: string) =>
  screen.getByRole("article", { name: title }) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["png"]), { status: 200 })),
  );
  pngToJpeg.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
});

describe("DirectionResults", () => {
  it("shows each direction's name, size and why it works", () => {
    results();
    const first = within(card("Playful product story"));
    expect(first.getByText("Direction 1")).toBeInTheDocument();
    expect(first.getByText("1080 × 1350")).toBeInTheDocument();
    expect(first.getByText("Why this works")).toBeInTheDocument();
    expect(first.getByText("Cutout sits on a warm arch")).toBeInTheDocument();
    expect(screen.getByText("Built around cake.png")).toBeInTheDocument();
  });

  /* Editing is phase 2: a control for it now would be a placeholder. */
  it("has downloads, send and regenerate on every card and no edit control", () => {
    results();
    for (const title of ["Playful product story", "Editorial arch frame"]) {
      const c = within(card(title));
      expect(
        c.getByRole("link", { name: /download png/i }),
      ).toBeInTheDocument();
      expect(
        c.getByRole("button", { name: /download jpg/i }),
      ).toBeInTheDocument();
      expect(
        c.getByRole("button", { name: /send to design team/i }),
      ).toBeInTheDocument();
      expect(
        c.getByRole("button", { name: /regenerate/i }),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("shows the design at full card width with a skeleton until it loads", async () => {
    results();
    const c = within(card("Playful product story"));
    const img = c.getByRole("img", { name: /Playful product story/ });
    expect(img).toHaveClass("w-full");
    expect(c.getByRole("status")).toHaveTextContent(
      "Loading the design preview…",
    );

    fireEvent.load(img);
    await waitFor(() => expect(c.queryByRole("status")).toBeNull());
    expect(img).toBeVisible();
  });

  /* An expired signed URL or a missing object: the skeleton must not keep
     claiming the design is on its way. */
  it("says the preview is unavailable when the image fails to load", () => {
    results();
    const c = within(card("Playful product story"));
    fireEvent.error(c.getByRole("img", { name: /Playful product story/ }));

    expect(c.getByRole("status")).toHaveTextContent("Preview unavailable");
    expect(c.queryByText("Loading the design preview…")).toBeNull();
    expect(c.queryByRole("img", { name: /Playful/ })).toBeNull();
    /* Downloads go through the route, not the preview URL, so they stay. */
    expect(c.getByRole("link", { name: /download png/i })).toBeInTheDocument();
  });

  it("downloads the PNG through the authorised route and records it", async () => {
    results();
    const link = within(card("Playful product story")).getByRole("link", {
      name: /download png/i,
    });
    expect(link).toHaveAttribute("href", "/api/design/generations/d1/download");
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(captureEvent).toHaveBeenCalledWith("design_downloaded", {
      format: "png",
      image_source: "upload",
    });
  });

  it("makes the JPG at the design's size and records it", async () => {
    let finish: (b: Blob) => void = () => {};
    pngToJpeg.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    results({
      slots: [
        ready(direction("d1", { imageSource: "ko" })),
        ready(direction("d2")),
      ],
    });
    await userEvent.click(
      within(card("Playful product story")).getByRole("button", {
        name: /download jpg/i,
      }),
    );

    /* Keyed to the card: the other card's JPG button is untouched. */
    expect(
      within(card("Playful product story")).getByRole("button", {
        name: /making jpg/i,
      }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      within(card("Editorial arch frame")).getByRole("button", {
        name: /download jpg/i,
      }),
    ).toBeEnabled();

    finish(new Blob(["jpeg"], { type: "image/jpeg" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/design/generations/d1/download");
    expect(pngToJpeg.mock.calls[0][1]).toEqual({ width: 1080, height: 1350 });
    expect(saveBlob.mock.calls[0][1]).toBe("instagram-post-1080x1350-d1.jpg");
    expect(captureEvent).toHaveBeenCalledWith("design_downloaded", {
      format: "jpg",
      image_source: "ko",
    });
  });

  it("says so when the JPG cannot be made", async () => {
    pngToJpeg.mockRejectedValue(new Error("no canvas"));
    results();
    await userEvent.click(
      within(card("Playful product story")).getByRole("button", {
        name: /download jpg/i,
      }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("sends a card's own design to the design team", async () => {
    const { props } = results();
    await userEvent.click(
      within(card("Editorial arch frame")).getByRole("button", {
        name: /send to design team/i,
      }),
    );
    expect(props.onSendToTeam).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d2" }),
    );
  });

  /* Keyed to the row: one card sending must not make the other claim it is
     working too. */
  it("shows sending on that card only", () => {
    results({ sendingId: "d1" });
    expect(
      within(card("Playful product story")).getByRole("button", {
        name: "Sending…",
      }),
    ).toHaveAttribute("aria-busy", "true");
    const other = within(card("Editorial arch frame")).getByRole("button", {
      name: /send to design team/i,
    });
    expect(other).toBeEnabled();
    expect(other).not.toHaveAttribute("aria-busy");
  });

  it("regenerates one slot while the other stays usable", () => {
    const { props } = results({ regeneratingSlot: 0 });
    expect(
      within(card("Playful product story")).getByRole("status"),
    ).toHaveTextContent("Making a new direction…");
    expect(
      screen.getByRole("button", { name: "Regenerating…" }),
    ).toHaveAttribute("aria-busy", "true");
    /* "Wait", not "working": the other card is disabled, not spinning. */
    const other = within(card("Editorial arch frame")).getByRole("button", {
      name: "Regenerate direction 2",
    });
    expect(other).toBeDisabled();
    expect(other).not.toHaveAttribute("aria-busy");
    expect(
      within(card("Editorial arch frame")).getByRole("link", {
        name: /download png/i,
      }),
    ).toBeInTheDocument();
    expect(props.onRegenerate).not.toHaveBeenCalled();
  });

  /* An anchor styled as disabled still follows its href on Enter, which
     would download the design that is being replaced. */
  it("makes the regenerating card's downloads truly inert", async () => {
    results({ regeneratingSlot: 0 });
    const c = within(card("Playful product story"));
    expect(c.queryByRole("link", { name: /download png/i })).toBeNull();
    const png = c.getByRole("button", { name: /download png/i });
    expect(png).toBeDisabled();
    expect(png).not.toHaveAttribute("href");

    png.focus();
    expect(png).not.toHaveFocus();
    await userEvent.keyboard("{Enter}");
    fireEvent.keyDown(png, { key: "Enter" });
    fireEvent.click(png);
    expect(captureEvent).not.toHaveBeenCalled();

    expect(c.getByRole("button", { name: /download jpg/i })).toBeDisabled();
    expect(
      c.getByRole("button", { name: /send to design team/i }),
    ).toBeDisabled();
  });

  it("calls regenerate with the card's slot", async () => {
    const { props } = results();
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate direction 2" }),
    );
    expect(props.onRegenerate).toHaveBeenCalledWith(1);
  });

  it("shows a slot regenerate failure on that card only", () => {
    results({ regenerateError: { slot: 1, message: "Regenerating failed." } });
    expect(
      within(card("Editorial arch frame")).getByRole("alert"),
    ).toHaveTextContent("Regenerating failed.");
    expect(
      within(card("Playful product story")).queryByRole("alert"),
    ).toBeNull();
  });

  it("states a direction that did not render and lets it be regenerated", async () => {
    const { props } = results({
      slots: [ready(direction("d1")), failedSlot("d2")],
    });
    expect(screen.getByText("1 of 2 directions came back.")).toHaveAttribute(
      "role",
      "status",
    );
    const failed = within(
      screen.getByRole("article", { name: "Direction 2 did not render" }),
    );
    await userEvent.click(
      failed.getByRole("button", { name: "Regenerate direction 2" }),
    );
    expect(props.onRegenerate).toHaveBeenCalledWith(1);
  });

  it("shows an empty state with a way forward when nothing came back", async () => {
    const { props } = results({ slots: [] });
    expect(
      screen.getByRole("heading", { name: "No designs yet" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Choose imagery" }),
    );
    expect(props.onChooseImagery).toHaveBeenCalled();
  });

  /* A row from before directions existed renders as it always did. */
  it("renders a legacy row without an empty rationale", () => {
    results({
      slots: [ready(direction("old", { direction: null, imageSource: null }))],
      source: null,
    });
    expect(screen.queryByText("Why this works")).toBeNull();
    expect(
      screen.getByRole("article", { name: "Make today sweeter" }),
    ).toBeInTheDocument();
  });
});
