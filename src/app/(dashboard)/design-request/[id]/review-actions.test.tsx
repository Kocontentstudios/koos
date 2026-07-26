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

describe("ReviewActions", () => {
  it("requests a revision with an empty annotations array when nothing was marked up", async () => {
    const fetchMock = stubFetchOk();
    render(<ReviewActions ticketId="t-1" />);

    fireEvent.click(screen.getByRole("button", { name: /request revision/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toEqual({ action: "revise", annotations: [] });
  });

  it("includes annotations for a marked-up deliverable in the revise POST body", async () => {
    const fetchMock = stubFetchOk();
    render(
      <ReviewActions
        ticketId="t-1"
        deliverables={[
          { id: "d-1", fileName: "cover.png", url: "/img/cover.png" },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /mark up cover\.png/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /add fake mark/i }));
    fireEvent.click(screen.getByRole("button", { name: /request revision/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
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

  it("leaves approve untouched by annotation state", async () => {
    const fetchMock = stubFetchOk();
    render(
      <ReviewActions
        ticketId="t-1"
        deliverables={[
          { id: "d-1", fileName: "cover.png", url: "/img/cover.png" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toEqual({ action: "approve" });
  });
});
