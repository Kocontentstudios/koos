import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateCalendarItemAction = vi.fn();
const deleteCalendarItemAction = vi.fn();
const updateCalendarItemStatusAction = vi.fn();
const refresh = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("./actions", () => ({
  updateCalendarItemAction: (id: string, input: unknown) =>
    updateCalendarItemAction(id, input),
  deleteCalendarItemAction: (id: string) => deleteCalendarItemAction(id),
  updateCalendarItemStatusAction: (id: string, status: unknown) =>
    updateCalendarItemStatusAction(id, status),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
  },
}));
vi.mock("@/components/design/generate-design-button", () => ({
  GenerateDesignButton: () => null,
}));

import { CalendarItemDrawer } from "./calendar-item-drawer";
import type { CalendarItem } from "./types";

function item(over: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: "i1",
    date: new Date("2026-09-12T00:00:00Z"),
    time: "10:00 AM",
    platform: "Instagram",
    contentType: "Post",
    title: "Sale announcement",
    brief: null,
    caption: "50% off, today only. #KOOS",
    notes: "Confirm stock with Tolu",
    designRequired: false,
    designType: null,
    dimensions: null,
    status: "draft",
    source: "manual",
    ...over,
  };
}

function setup(over: Partial<CalendarItem> = {}) {
  const onOpenChange = vi.fn();
  render(
    <CalendarItemDrawer
      item={item(over)}
      brandId="b1"
      open
      onOpenChange={onOpenChange}
      submitted={false}
      onRequestDesign={vi.fn()}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  /* resetAllMocks, not clearAllMocks: clear wipes call history but leaves
     implementations, so a mockRejectedValue set by one test would leak into
     every later one. */
  vi.resetAllMocks();
  updateCalendarItemAction.mockResolvedValue({ ok: true });
  deleteCalendarItemAction.mockResolvedValue({ ok: true });
  updateCalendarItemStatusAction.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("status changes", () => {
  it("sends the new status and keeps it on success", async () => {
    setup({ status: "draft" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "ready");
    expect(updateCalendarItemStatusAction).toHaveBeenCalledWith("i1", "ready");
    expect(screen.getByLabelText("Status")).toHaveValue("ready");
    expect(refresh).toHaveBeenCalled();
  });

  it("reverts the optimistic value and reports a rejected action", async () => {
    updateCalendarItemStatusAction.mockResolvedValue({
      ok: false,
      error: "Item not found",
    });
    setup({ status: "draft" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "ready");
    expect(toastError).toHaveBeenCalledWith("Item not found");
    expect(screen.getByLabelText("Status")).toHaveValue("draft");
    expect(refresh).not.toHaveBeenCalled();
  });

  /* Reverting only on res.ok === false would leave the select showing a status
     the database never took, silently, whenever the request itself fails. */
  it("reverts and reports when the action throws", async () => {
    updateCalendarItemStatusAction.mockRejectedValue(new Error("offline"));
    setup({ status: "draft" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "ready");
    expect(toastError).toHaveBeenCalledWith("Could not update status");
    expect(screen.getByLabelText("Status")).toHaveValue("draft");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("source badge", () => {
  it("labels a manual entry", () => {
    setup({ source: "manual" });
    expect(screen.getByText("Added by you")).toBeInTheDocument();
    expect(screen.queryByText("KO generated")).toBeNull();
  });

  it("labels an AI entry", () => {
    setup({ source: "ai" });
    expect(screen.getByText("KO generated")).toBeInTheDocument();
    expect(screen.queryByText("Added by you")).toBeNull();
  });
});

describe("caption and notes", () => {
  it("shows caption verbatim, hashtags intact", () => {
    setup();
    expect(screen.getByText("50% off, today only. #KOOS")).toBeInTheDocument();
  });

  it("shows notes", () => {
    setup();
    expect(screen.getByText("Confirm stock with Tolu")).toBeInTheDocument();
  });

  it("omits both sections when empty", () => {
    setup({ caption: null, notes: null });
    expect(screen.queryByText("Caption")).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows the pending-brief placeholder for an AI item", () => {
    setup({ source: "ai", brief: null });
    expect(
      screen.getByText(/KO is still writing this brief/),
    ).toBeInTheDocument();
  });

  it("never shows the pending-brief placeholder on a manual entry", () => {
    setup({ source: "manual", brief: null });
    expect(screen.queryByText(/KO is still writing this brief/)).toBeNull();
  });

  it("round-trips an edited caption through the save action", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Edit details/ }));
    const caption = screen.getByLabelText("Caption");
    expect(caption).toHaveValue("50% off, today only. #KOOS");
    await userEvent.clear(caption);
    await userEvent.type(caption, "New copy");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateCalendarItemAction).toHaveBeenCalledTimes(1);
    const [id, input] = updateCalendarItemAction.mock.calls[0];
    expect(id).toBe("i1");
    expect(input).toMatchObject({ caption: "New copy", date: "2026-09-12" });
    expect(toastSuccess).toHaveBeenCalledWith("Calendar item updated");
  });
});

/*
 * Retaining the edit draft across a dismissal meant reopening the item showed
 * stale text over a refreshed item, and the next Save wrote that abandoned
 * text over whatever a teammate saved in between.
 */
describe("abandoning an edit", () => {
  it("drops the draft when dismissed with Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Edit details/ }));
    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Abandoned text");
    await userEvent.keyboard("{Escape}");
    // Back to read mode: the edit form is gone and nothing was submitted.
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    expect(updateCalendarItemAction).not.toHaveBeenCalled();
  });

  it("drops the draft when dismissed with the close button", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Edit details/ }));
    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Abandoned text");
    await userEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    expect(updateCalendarItemAction).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("does not delete until the confirm dialog is accepted", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(deleteCalendarItemAction).not.toHaveBeenCalled();
    expect(
      screen.getByText(/will be removed from the calendar/),
    ).toBeInTheDocument();
  });

  it("deletes, closes and refreshes once confirmed", async () => {
    const { onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    const dialogConfirm = screen
      .getAllByRole("button", { name: "Delete" })
      .at(-1);
    await userEvent.click(dialogConfirm as HTMLElement);

    expect(deleteCalendarItemAction).toHaveBeenCalledWith("i1");
    expect(toastSuccess).toHaveBeenCalledWith("Entry deleted");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the drawer open and reports the error when delete fails", async () => {
    deleteCalendarItemAction.mockResolvedValue({
      ok: false,
      error: "Item not found",
    });
    const { onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    const dialogConfirm = screen
      .getAllByRole("button", { name: "Delete" })
      .at(-1);
    await userEvent.click(dialogConfirm as HTMLElement);

    expect(toastError).toHaveBeenCalledWith("Item not found");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("reports a thrown delete instead of failing silently", async () => {
    deleteCalendarItemAction.mockRejectedValue(new Error("offline"));
    const { onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    const confirm = screen.getAllByRole("button", { name: "Delete" }).at(-1);
    await userEvent.click(confirm as HTMLElement);
    expect(toastError).toHaveBeenCalledWith("Could not delete the entry");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("abandons the delete when the dialog is cancelled", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteCalendarItemAction).not.toHaveBeenCalled();
  });
});
