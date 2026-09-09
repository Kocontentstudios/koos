import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCalendarItemAction = vi.fn();
const refresh = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("./actions", () => ({
  createCalendarItemAction: (calendarId: string, input: unknown) =>
    createCalendarItemAction(calendarId, input),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
  },
}));

import { AddItemDrawer } from "./add-item-drawer";

const DAY = new Date("2026-09-12T00:00:00Z");

function setup(date: Date | null = DAY) {
  const onOpenChange = vi.fn();
  render(
    <AddItemDrawer
      calendarId="c1"
      date={date}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  /* resetAllMocks, not clearAllMocks: clear wipes call history but leaves
     implementations, so a mockRejectedValue set by one test would leak into
     every later one. */
  vi.resetAllMocks();
  createCalendarItemAction.mockResolvedValue({ ok: true, id: "new-1" });
});

describe("AddItemDrawer", () => {
  it("seeds the date field from the clicked day", () => {
    setup();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-12");
    expect(screen.getByText("Saturday, September 12")).toBeInTheDocument();
  });

  it("offers caption and notes but not the AI brief", () => {
    setup();
    expect(screen.getByLabelText("Caption")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
    expect(screen.queryByLabelText("Brief")).toBeNull();
  });

  it("keeps the submit disabled until a title is typed", async () => {
    setup();
    const submit = screen.getByRole("button", { name: "Add to calendar" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Title"), "Sale announcement");
    expect(submit).toBeEnabled();
  });

  it("sends every field, then closes and refreshes on success", async () => {
    const { onOpenChange } = setup();
    await userEvent.type(screen.getByLabelText("Title"), "Sale announcement");
    await userEvent.type(screen.getByLabelText("Caption"), "50% off today");
    await userEvent.type(screen.getByLabelText("Notes"), "Check stock");
    await userEvent.click(
      screen.getByRole("button", { name: "Add to calendar" }),
    );

    expect(createCalendarItemAction).toHaveBeenCalledTimes(1);
    const [calendarId, input] = createCalendarItemAction.mock.calls[0];
    expect(calendarId).toBe("c1");
    expect(input).toMatchObject({
      title: "Sale announcement",
      caption: "50% off today",
      notes: "Check stock",
      date: "2026-09-12",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Added to calendar");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces the server error and stays open on failure", async () => {
    createCalendarItemAction.mockResolvedValue({
      ok: false,
      error: "Calendar not found",
    });
    const { onOpenChange } = setup();
    await userEvent.type(screen.getByLabelText("Title"), "Sale");
    await userEvent.click(
      screen.getByRole("button", { name: "Add to calendar" }),
    );
    expect(toastError).toHaveBeenCalledWith("Calendar not found");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  // The reseed guard keys on the date, so reopening the SAME day after a save
  // would otherwise redisplay the entry just created and invite a duplicate.
  it("clears the form after a successful add", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Title"), "Sale announcement");
    await userEvent.type(screen.getByLabelText("Caption"), "50% off today");
    await userEvent.click(
      screen.getByRole("button", { name: "Add to calendar" }),
    );

    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Caption")).toHaveValue("");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-12");
  });

  it("keeps the typed values when the add fails, so nothing is retyped", async () => {
    createCalendarItemAction.mockResolvedValue({
      ok: false,
      error: "Calendar not found",
    });
    setup();
    await userEvent.type(screen.getByLabelText("Title"), "Sale announcement");
    await userEvent.click(
      screen.getByRole("button", { name: "Add to calendar" }),
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Sale announcement");
  });

  /* Escape and backdrop clicks reach the Sheet's own onOpenChange, not the
     Cancel button. Testing only the button left the fix unguarded: two
     dismissal gestures on the same drawer produced different state. */
  it("clears the form when dismissed with Escape", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Title"), "Half-typed idea");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("clears the form when dismissed with the close button", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Title"), "Half-typed idea");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("clears the form when the add is cancelled", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Title"), "Half-typed idea");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("reports a thrown action instead of failing silently", async () => {
    createCalendarItemAction.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { onOpenChange } = setup();
    await userEvent.type(screen.getByLabelText("Title"), "Sale");
    await userEvent.click(
      screen.getByRole("button", { name: "Add to calendar" }),
    );
    expect(toastError).toHaveBeenCalledWith("Could not add the entry");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the design fields only once design is required", async () => {
    setup();
    expect(screen.queryByLabelText("Dimensions")).toBeNull();
    await userEvent.click(screen.getByLabelText("Design asset required"));
    expect(screen.getByLabelText("Dimensions")).toBeInTheDocument();
  });
});
