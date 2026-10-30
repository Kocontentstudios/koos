import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BRAND, frameRow, frameRows } from "./fixtures";
import { SetBuildingCard, SetCard } from "./set-card";
import { buildSet, type DesignSet } from "./set-model";

function setOf(rows = frameRows(5)): DesignSet {
  const set = buildSet(BRAND, rows, {});
  if (!set) throw new Error("no set");
  return set;
}

const cover = (container: HTMLElement) =>
  container.querySelector("img") as HTMLImageElement;
const box = (container: HTMLElement) =>
  cover(container).parentElement as HTMLElement;

describe("SetCard", () => {
  it("is one button naming the set, its count and its hook", async () => {
    const onOpen = vi.fn();
    const set = setOf();
    render(<SetCard set={set} onOpen={onOpen} />);
    const card = screen.getByRole("button", {
      name: "Open carousel, 5 slides: The launch",
    });
    expect(card).toHaveTextContent("5 slides");
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(set);
  });

  /* CLAUDE.md "Every wait gets an affordance": the grid holds the cover's
     shape and shows a skeleton until the picture is in, or has failed. */
  /* next/image reports a load only once the picture has decoded, a tick
     after the event, hence waitFor. */
  it("holds the frame's shape with a skeleton until the cover loads", async () => {
    const { container } = render(<SetCard set={setOf()} onOpen={vi.fn()} />);
    expect(box(container).style.aspectRatio).toBe("1080 / 1350");
    expect(container.querySelector("[data-slot=skeleton]")).not.toBeNull();
    fireEvent.load(cover(container));
    await waitFor(() =>
      expect(container.querySelector("[data-slot=skeleton]")).toBeNull(),
    );
  });

  it("drops the skeleton when the cover fails, rather than wait forever", async () => {
    const { container } = render(<SetCard set={setOf()} onOpen={vi.fn()} />);
    fireEvent.error(cover(container));
    await waitFor(() =>
      expect(container.querySelector("[data-slot=skeleton]")).toBeNull(),
    );
  });

  it("says how many frames did not render", () => {
    const rows = frameRows(5);
    rows[2] = frameRow(2, { status: "failed", url: null });
    render(<SetCard set={setOf(rows)} onOpen={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAccessibleName(
      /\. 1 didn't render$/,
    );
    expect(screen.getByText("1 failed")).toBeInTheDocument();
  });

  it("says a set is still being made and how far it has got", () => {
    const rows = frameRows(5);
    rows[4] = frameRow(4, { status: "pending", url: null });
    render(<SetCard set={setOf(rows)} onOpen={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Open carousel, 5 slides: The launch. Still being made, 4 of 5 ready",
    );
    expect(screen.getByText("4 of 5")).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).toBeNull();
  });
});

describe("SetBuildingCard", () => {
  it("says where a set with no frame yet has got, as a status", () => {
    const job = {
      jobId: "j1",
      setId: null,
      kind: "carousel" as const,
      frameCount: 5,
      done: 2,
      rendering: true,
    };
    const { rerender } = render(<SetBuildingCard job={job} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Making your carousel. Frame 3 of 5…",
    );
    expect(document.querySelector("[data-slot=skeleton]")).not.toBeNull();
    rerender(
      <SetBuildingCard job={{ ...job, rendering: false, kind: null }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Making your slides. Planning…",
    );
  });
});
