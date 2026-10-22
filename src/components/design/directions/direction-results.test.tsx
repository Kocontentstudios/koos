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
vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: (...a: unknown[]) => captureEvent(...a),
}));
vi.mock("@/lib/design/png-to-jpeg", async (original) => ({
  ...(await original<typeof import("@/lib/design/png-to-jpeg")>()),
  pngToJpeg: (...a: unknown[]) => pngToJpeg(...a),
  saveBlob: (...a: unknown[]) => saveBlob(...a),
}));

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
    sendNotices: {},
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

/* Every ready card keeps a mounted (and usually empty) sent-notice region, so
   a card can hold more than one status. */
function waitStatus(scope: HTMLElement): HTMLElement | null {
  return (
    within(scope)
      .queryAllByRole("status")
      .find((el) => el.getAttribute("data-slot") !== "sent-notice") ?? null
  );
}

function sentNotice(scope: HTMLElement): HTMLElement {
  const el = scope.querySelector<HTMLElement>("[data-slot=sent-notice]");
  if (!el) throw new Error("no sent notice region");
  expect(el).toHaveAttribute("role", "status");
  return el;
}

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
    expect(waitStatus(card("Playful product story"))).toHaveTextContent(
      "Loading the design preview…",
    );

    fireEvent.load(img);
    await waitFor(() =>
      expect(waitStatus(card("Playful product story"))).toBeNull(),
    );
    expect(img).toBeVisible();
  });

  /* An expired signed URL or a missing object: the skeleton must not keep
     claiming the design is on its way. */
  it("says the preview is unavailable when the image fails to load", () => {
    results();
    const c = within(card("Playful product story"));
    fireEvent.error(c.getByRole("img", { name: /Playful product story/ }));

    expect(waitStatus(card("Playful product story"))).toHaveTextContent(
      "Preview unavailable",
    );
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
    expect(
      await within(card("Playful product story")).findByRole("alert"),
    ).toHaveTextContent("The JPG couldn't be made. Download the PNG instead.");
    expect(
      within(card("Editorial arch frame")).queryByRole("alert"),
    ).toBeNull();
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("clears the JPG failure when the JPG is tried again", async () => {
    pngToJpeg.mockRejectedValueOnce(new Error("no canvas"));
    results();
    const c = within(card("Playful product story"));
    await userEvent.click(c.getByRole("button", { name: /download jpg/i }));
    await c.findByRole("alert");
    await userEvent.click(c.getByRole("button", { name: /download jpg/i }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    expect(c.queryByRole("alert")).toBeNull();
  });

  /* A toast sat over the dialog's footer; on a phone it hid "Stay here" for
     its whole lifetime. The outcome is said on the card instead. */
  it("says on the card that it was sent, and will not send it twice", () => {
    results({
      sendNotices: {
        d2: { tone: "sent", message: "Sent to the design team as DT-42" },
      },
    });
    const sent = within(card("Editorial arch frame"));
    expect(sentNotice(card("Editorial arch frame"))).toHaveTextContent(
      "Sent to the design team as DT-42",
    );
    const button = sent.getByRole("button", { name: /sent to design team/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("disabled");
    const other = within(card("Playful product story"));
    expect(sentNotice(card("Playful product story"))).toBeEmptyDOMElement();
    expect(
      other.getByRole("button", { name: /send to design team/i }),
    ).toBeEnabled();
  });

  it("says on the card when sending failed, and lets it be tried again", () => {
    results({
      sendNotices: {
        d1: { tone: "error", message: "Could not send to the design team." },
      },
    });
    const c = within(card("Playful product story"));
    expect(c.getByRole("alert")).toHaveTextContent(
      "Could not send to the design team.",
    );
    expect(
      c.getByRole("button", { name: /send to design team/i }),
    ).toBeEnabled();
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
    expect(waitStatus(card("Regenerating direction 1"))).toHaveTextContent(
      "Making a new direction…",
    );
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
  /* Round 2 left the old title and "Why this works" under the skeleton, so
     the card described a design that was no longer there. */
  it("hides the old title and reasons while a slot regenerates", () => {
    results({ regeneratingSlot: 0 });
    const regenerating = card("Regenerating direction 1");
    const c = within(regenerating);
    expect(c.getByText("Direction 1")).toBeVisible();
    expect(screen.queryByText("Playful product story")).toBeNull();
    expect(c.queryByText("Why this works")).toBeNull();
    expect(c.queryByText("Cutout sits on a warm arch")).toBeNull();
    /* Placeholders hold the title and reasons' place, so the card keeps
       its shape: the design frame, the title and three reason lines. */
    expect(
      regenerating.querySelectorAll('[data-slot="skeleton"]'),
    ).toHaveLength(5);
    expect(
      within(card("Editorial arch frame")).getByText("Why this works"),
    ).toBeVisible();
  });

  it("makes the regenerating card's downloads truly inert", async () => {
    results({ regeneratingSlot: 0 });
    const c = within(card("Regenerating direction 1"));
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
    const failedCard = screen.getByRole("article", {
      name: "Direction 2 did not render",
    });
    const failed = within(failedCard);
    expect(failed.getByText("This direction didn't render")).toBeVisible();
    expect(failed.getByText(/The other direction is ready/)).toBeVisible();
    await userEvent.click(
      failed.getByRole("button", { name: "Regenerate direction 2" }),
    );
    expect(props.onRegenerate).toHaveBeenCalledWith(1);
  });

  /* Round 3 left a regenerating failed slot's body empty apart from the
     button, where a ready slot shows reason placeholders (L17 vs L08). */
  it("gives a regenerating failed slot the same wait as a ready one", () => {
    results({
      slots: [ready(direction("d1")), failedSlot("d2")],
      regeneratingSlot: 1,
    });
    const regenerating = card("Regenerating direction 2");
    expect(
      regenerating.querySelectorAll('[data-slot="skeleton"]'),
    ).toHaveLength(5);
    expect(waitStatus(regenerating)).toHaveTextContent(
      "Making a new direction…",
    );
    expect(
      within(regenerating).queryByText("This direction didn't render"),
    ).toBeNull();
    expect(
      within(regenerating).getByRole("button", { name: /regenerating/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("does not point to another direction when none rendered", () => {
    results({ slots: [failedSlot("d1"), failedSlot("d2")] });
    for (const name of [
      "Direction 1 did not render",
      "Direction 2 did not render",
    ]) {
      const c = within(screen.getByRole("article", { name }));
      expect(c.queryByText(/The other direction is ready/)).toBeNull();
      expect(c.getByText("Regenerate it to try again.")).toBeVisible();
    }
  });

  /* In light mode --surface-container-lowest is the card's own #ffffff, so a
     failed or unavailable slot drawn with it had no edge at all (round 2,
     L16-one-failed.png). theme-contrast.test.ts holds the tokens; this holds
     the frame to them. */
  it.each([
    [
      "a failed slot",
      () => results({ slots: [ready(direction("d1")), failedSlot("d2")] }),
      "Direction 2 did not render",
      "This direction didn't render",
    ],
    [
      "an unavailable preview",
      () => results({ slots: [ready(direction("d1", { url: null }))] }),
      "Playful product story",
      "Preview unavailable",
    ],
  ])("draws %s as a visible box", (_label, show, article, text) => {
    show();
    const c = within(screen.getByRole("article", { name: article }));
    const frame = (
      c.queryByText("Preview unavailable") ??
      c.getByText(/The other direction is ready/)
    ).parentElement as HTMLElement;
    expect(c.getByText(text)).toBeVisible();
    expect(frame.className).toContain("bg-[var(--surface-container-low)]");
    expect(frame.className).not.toContain("surface-container-lowest");
    const outline = frame.querySelector('[aria-hidden="true"].border-dashed');
    expect(outline).not.toBeNull();
    expect((outline as HTMLElement).style.borderColor).toBe(
      "var(--border-control)",
    );
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

  /* jsdom keeps focus on a natively disabled button; a browser drops it to
     <body>. So a busy control must also not carry `disabled`. */
  function expectHoldsFocus(el: HTMLElement) {
    expect(el).toHaveFocus();
    expect(el).not.toHaveAttribute("disabled");
    expect(el).toHaveAttribute("aria-disabled", "true");
  }

  describe("keyboard focus through a wait", () => {
    it("stays on Download JPG while the JPG is made", async () => {
      let finish: (blob: Blob) => void = () => {};
      pngToJpeg.mockReturnValue(
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
      );
      const user = userEvent.setup();
      results();
      const jpg = within(card("Playful product story")).getByRole("button", {
        name: /download jpg/i,
      });
      jpg.focus();
      await user.keyboard("{Enter}");
      const busy = await within(card("Playful product story")).findByRole(
        "button",
        { name: /making jpg/i },
      );
      expectHoldsFocus(busy);
      finish(new Blob(["jpeg"], { type: "image/jpeg" }));
      await waitFor(() =>
        expect(
          within(card("Playful product story")).getByRole("button", {
            name: /download jpg/i,
          }),
        ).toHaveFocus(),
      );
    });

    it("stays on Send to design team while it sends", () => {
      const { props, rerender } = results();
      within(card("Playful product story"))
        .getByRole("button", { name: /send to design team/i })
        .focus();
      rerender(<DirectionResults {...props} sendingId="d1" />);
      expectHoldsFocus(
        within(card("Playful product story")).getByRole("button", {
          name: /sending/i,
        }),
      );
      rerender(<DirectionResults {...props} sendingId={null} />);
      expect(
        within(card("Playful product story")).getByRole("button", {
          name: /send to design team/i,
        }),
      ).toHaveFocus();
    });

    it("lands on the new card when a regenerate replaces it", () => {
      const { props, rerender } = results({ regeneratingSlot: null });
      within(card("Playful product story"))
        .getByRole("button", { name: /regenerate direction 1/i })
        .focus();
      rerender(<DirectionResults {...props} regeneratingSlot={0} />);
      expectHoldsFocus(
        within(card("Regenerating direction 1")).getByRole("button", {
          name: /regenerating/i,
        }),
      );

      const fresh = direction("d3", {
        direction: { title: "Bold split layout", reasons: ["Clear split"] },
      });
      rerender(
        <DirectionResults
          {...props}
          slots={[ready(fresh), props.slots[1]]}
          regeneratingSlot={null}
        />,
      );
      /* In the same commit, not a frame later: by then the dialog's focus
         manager has parked focus on the popup and announced the dialog. */
      expect(card("Bold split layout")).toHaveFocus();
    });

    it("lands on the new card when a failed slot comes back", () => {
      const { props, rerender } = results({
        slots: [ready(direction("d1")), failedSlot("d2")],
      });
      within(card("Direction 2 did not render"))
        .getByRole("button", { name: /regenerate direction 2/i })
        .focus();
      rerender(<DirectionResults {...props} regeneratingSlot={1} />);
      expectHoldsFocus(
        within(card("Regenerating direction 2")).getByRole("button", {
          name: /regenerating/i,
        }),
      );
      rerender(
        <DirectionResults
          {...props}
          slots={[props.slots[0], ready(direction("d2"))]}
          regeneratingSlot={null}
        />,
      );
      expect(card("Editorial arch frame")).toHaveFocus();
    });

    it("keeps focus on Regenerate when the regenerate fails", async () => {
      const { props, rerender } = results();
      const button = within(card("Playful product story")).getByRole("button", {
        name: /regenerate direction 1/i,
      });
      button.focus();
      rerender(<DirectionResults {...props} regeneratingSlot={0} />);
      rerender(
        <DirectionResults
          {...props}
          regenerateError={{ slot: 0, message: "Regenerating didn't work." }}
        />,
      );
      await new Promise((r) => requestAnimationFrame(r));
      expect(
        within(card("Playful product story")).getByRole("button", {
          name: /regenerate direction 1/i,
        }),
      ).toHaveFocus();
    });

    it("leaves focus alone if the user moved on during the wait", async () => {
      const { props, rerender } = results();
      rerender(<DirectionResults {...props} regeneratingSlot={0} />);
      const other = within(card("Editorial arch frame")).getByRole("button", {
        name: /download jpg/i,
      });
      other.focus();
      rerender(
        <DirectionResults
          {...props}
          slots={[ready(direction("d3")), props.slots[1]]}
          regeneratingSlot={null}
        />,
      );
      await new Promise((r) => requestAnimationFrame(r));
      expect(other).toHaveFocus();
    });
  });
});
