import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnnotationCanvasMark } from "@/components/design/annotation-canvas";
import { ReviewActions } from "./review-actions";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// The canvas's real drawing interactions rely on layout metrics jsdom
// doesn't provide; stand in with a button that emits a fixed mark so this
// test only exercises the ReviewActions <-> AnnotationCanvas wiring.
vi.mock("@/components/design/annotation-canvas", () => ({
  AnnotationCanvas: ({
    onChange,
  }: {
    imageUrl: string;
    onChange: (marks: AnnotationCanvasMark[]) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange([
          {
            shapes: [
              { type: "rect", coords: [0.1, 0.1, 0.4, 0.4], color: "#f43f5e" },
            ],
          },
        ])
      }
    >
      Add fake mark
    </button>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetchOk() {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ ticket: {} }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const DELIVERABLES = [
  { id: "d-1", fileName: "cover.png", url: "/img/cover.png" },
];

function bodyOf(fetchMock: ReturnType<typeof stubFetchOk>) {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
}

function openRevisionPanel() {
  fireEvent.click(screen.getByRole("button", { name: /request revision/i }));
}

function typeNote(text: string) {
  fireEvent.change(screen.getByLabelText(/what would you like changed/i), {
    target: { value: text },
  });
}

describe("ReviewActions", () => {
  describe("revision flow", () => {
    // The note box is the whole point of the revision path, so it must not
    // submit on the first click — it opens the panel and waits for input.
    it("opens a note box instead of submitting on the first click", () => {
      const fetchMock = stubFetchOk();
      render(<ReviewActions ticketId="t-1" version={1} />);

      expect(
        screen.queryByLabelText(/what would you like changed/i),
      ).not.toBeInTheDocument();

      openRevisionPanel();

      expect(
        screen.getByLabelText(/what would you like changed/i),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps submit disabled until there is a note or a mark", () => {
      render(<ReviewActions ticketId="t-1" version={1} />);
      openRevisionPanel();

      const submit = screen.getByRole("button", { name: /submit request/i });
      expect(submit).toBeDisabled();

      typeNote("Make the logo bigger");
      expect(submit).toBeEnabled();
    });

    it("posts the note the client typed", async () => {
      const fetchMock = stubFetchOk();
      render(<ReviewActions ticketId="t-1" version={1} />);

      openRevisionPanel();
      typeNote("Make the logo bigger");
      fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(bodyOf(fetchMock)).toEqual({
        action: "revise",
        note: "Make the logo bigger",
        annotations: [],
      });
    });

    it("includes annotations for a marked-up deliverable", async () => {
      const fetchMock = stubFetchOk();
      render(
        <ReviewActions
          ticketId="t-1"
          version={1}
          deliverables={DELIVERABLES}
        />,
      );

      openRevisionPanel();
      fireEvent.click(
        screen.getByRole("button", { name: /mark up cover\.png/i }),
      );
      fireEvent.click(screen.getByRole("button", { name: /add fake mark/i }));
      fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = bodyOf(fetchMock);
      expect(body.action).toBe("revise");
      expect(body.annotations).toEqual([
        {
          deliverableId: "d-1",
          shapes: [
            { type: "rect", coords: [0.1, 0.1, 0.4, 0.4], color: "#f43f5e" },
          ],
        },
      ]);
    });

    it("submits on markup alone, with no note", async () => {
      const fetchMock = stubFetchOk();
      render(
        <ReviewActions
          ticketId="t-1"
          version={1}
          deliverables={DELIVERABLES}
        />,
      );

      openRevisionPanel();
      fireEvent.click(
        screen.getByRole("button", { name: /mark up cover\.png/i }),
      );
      fireEvent.click(screen.getByRole("button", { name: /add fake mark/i }));

      const submit = screen.getByRole("button", { name: /submit request/i });
      expect(submit).toBeEnabled();
      fireEvent.click(submit);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(bodyOf(fetchMock).note).toBeUndefined();
    });

    it("closes the panel on cancel without posting", () => {
      const fetchMock = stubFetchOk();
      render(<ReviewActions ticketId="t-1" version={1} />);

      openRevisionPanel();
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(
        screen.queryByLabelText(/what would you like changed/i),
      ).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("satisfied flow", () => {
    // Approval is terminal, so it asks once before closing the request.
    it("confirms before approving", async () => {
      const fetchMock = stubFetchOk();
      render(
        <ReviewActions
          ticketId="t-1"
          version={1}
          deliverables={DELIVERABLES}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /^satisfied$/i }));
      expect(fetchMock).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole("button", { name: /yes, i'm satisfied/i }),
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(bodyOf(fetchMock)).toEqual({ action: "approve" });
    });

    it("backs out of the confirmation without approving", () => {
      const fetchMock = stubFetchOk();
      render(<ReviewActions ticketId="t-1" version={1} />);

      fireEvent.click(screen.getByRole("button", { name: /^satisfied$/i }));
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(
        screen.getByRole("button", { name: /request revision/i }),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("leaves approve untouched by annotation state", async () => {
      const fetchMock = stubFetchOk();
      render(
        <ReviewActions
          ticketId="t-1"
          version={1}
          deliverables={DELIVERABLES}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /^satisfied$/i }));
      fireEvent.click(
        screen.getByRole("button", { name: /yes, i'm satisfied/i }),
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(bodyOf(fetchMock)).toEqual({ action: "approve" });
    });
  });

  describe("final round", () => {
    // With the loop capped at 3, the last round offers only a way to close.
    it("drops Request Revision on the third round", () => {
      render(<ReviewActions ticketId="t-1" version={3} />);

      expect(
        screen.queryByRole("button", { name: /request revision/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^satisfied$/i }),
      ).toBeInTheDocument();
    });

    it("explains that the round was the last one", () => {
      render(<ReviewActions ticketId="t-1" version={3} />);
      expect(screen.getByText(/final revision round/i)).toBeInTheDocument();
    });

    it("keeps Request Revision on earlier rounds", () => {
      render(<ReviewActions ticketId="t-1" version={2} />);
      expect(
        screen.getByRole("button", { name: /request revision/i }),
      ).toBeInTheDocument();
    });

    it("shows the client where they are in the loop", () => {
      render(<ReviewActions ticketId="t-1" version={2} />);
      expect(screen.getByText(/round 2 of 3/i)).toBeInTheDocument();
    });
  });

  describe("errors", () => {
    it("surfaces a server error inline and does not refresh", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: "This design isn't awaiting review." }),
            { status: 409 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      refreshMock.mockClear();
      render(<ReviewActions ticketId="t-1" version={1} />);

      fireEvent.click(screen.getByRole("button", { name: /^satisfied$/i }));
      fireEvent.click(
        screen.getByRole("button", { name: /yes, i'm satisfied/i }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This design isn't awaiting review.",
      );
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });
});
