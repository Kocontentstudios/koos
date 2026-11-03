import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pollGenerationJob = vi.fn();
vi.mock("@/lib/generation/poll-job", () => ({
  pollGenerationJob: (...a: unknown[]) => pollGenerationJob(...a),
}));

import { PollTimeoutError } from "@/lib/generation/poll-errors";
import { withDesignFlags } from "@/lib/testing/ko-imagery";
import { BRAND, frameRow, frameRows } from "./fixtures";
import { buildSet, type DesignSet } from "./set-model";
import { SetViewerDialog } from "./set-viewer-dialog";

const FLAGS_ON = withDesignFlags({ koImagery: true, multiFrame: true });

function setOf(rows = frameRows(5)): DesignSet {
  return buildSet(BRAND, rows) as DesignSet;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ jobId: "job-2" }))),
  );
});
afterEach(() => vi.unstubAllGlobals());

/* The grid hands the open viewer a fresher read of the same set every few
   seconds while frames land (useSetWatch). That must never cancel a
   regenerate the user started in the viewer. */
describe("SetViewerDialog fed a fresher read of its set", () => {
  it("swaps landed frames in and keeps a regenerate in flight", async () => {
    pollGenerationJob.mockImplementation(() => new Promise(() => {}));
    const building = frameRows(5);
    building[4] = frameRow(4, { status: "pending", url: null });
    const { rerender } = render(
      <SetViewerDialog set={setOf(building)} onClose={vi.fn()} />,
      FLAGS_ON,
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Regenerate frame 1" }),
    );
    expect(
      within(dialog).getByRole("button", { name: /Regenerating…/ }),
    ).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      rerender(<SetViewerDialog set={setOf(frameRows(5))} onClose={vi.fn()} />);
    });
    await waitFor(() =>
      expect(
        within(dialog).queryByText(/The rest appear here as they land/),
      ).toBeNull(),
    );
    expect(
      within(dialog).getByRole("button", { name: /Regenerating…/ }),
    ).toHaveAttribute("aria-busy", "true");
  });

  /* The viewer stopped waiting on frame 1's job; the grid's watcher then
     read the new frame. The wait it was showing is over. */
  it("ends a frame's wait when its new row arrives through the grid", async () => {
    pollGenerationJob.mockRejectedValueOnce(new PollTimeoutError());
    const { rerender } = render(
      <SetViewerDialog set={setOf()} onClose={vi.fn()} />,
      FLAGS_ON,
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Regenerate frame 1" }),
    );
    expect(
      await within(dialog).findByRole("button", { name: "Keep waiting" }),
    ).toBeInTheDocument();
    const landed = [
      ...frameRows(5),
      frameRow(0, { id: "f0-new", createdAt: "2026-10-30T12:00:00.000Z" }),
    ];
    await act(async () => {
      rerender(<SetViewerDialog set={setOf(landed)} onClose={vi.fn()} />);
    });
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("button", { name: "Keep waiting" }),
      ).toBeNull(),
    );
    expect(
      within(dialog).getByRole("button", { name: "Regenerate frame 1" }),
    ).toBeEnabled();
  });
});
