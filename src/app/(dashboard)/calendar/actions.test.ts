import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const requireBrand = vi.fn();
const getCalendarItemById = vi.fn();
const getCalendarById = vi.fn();
const createCalendarItem = vi.fn();
const deleteCalendarItem = vi.fn();
const updateCalendarItem = vi.fn();
const updateCalendarItemStatus = vi.fn();
const widenCalendarWindow = vi.fn();
const nextSortOrderForDate = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/require-brand", () => ({
  requireBrand: () => requireBrand(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("@/lib/db/queries", () => ({
  getCalendarItemById: (id: string) => getCalendarItemById(id),
  getCalendarById: (id: string) => getCalendarById(id),
  createCalendarItem: (row: unknown) => createCalendarItem(row),
  deleteCalendarItem: (id: string) => deleteCalendarItem(id),
  updateCalendarItem: (id: string, patch: unknown) =>
    updateCalendarItem(id, patch),
  updateCalendarItemStatus: (id: string, status: unknown) =>
    updateCalendarItemStatus(id, status),
  widenCalendarWindow: (id: string, date: Date) =>
    widenCalendarWindow(id, date),
  nextSortOrderForDate: (id: string, date: Date) =>
    nextSortOrderForDate(id, date),
}));

import {
  createCalendarItemAction,
  deleteCalendarItemAction,
  updateCalendarItemAction,
  updateCalendarItemStatusAction,
} from "./actions";

/* The ±5y date bound is evaluated against the wall clock, so the fixture dates
   below would start failing on their own five years from now. Pin the clock:
   a gate test must never depend on when it runs. */
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const BRAND = { id: "b1" };
const OTHER_BRAND_CALENDAR = {
  id: "c9",
  brandId: "b-other",
  startDate: new Date("2026-09-01T00:00:00Z"),
  endDate: new Date("2026-11-29T00:00:00Z"),
};
const CALENDAR = {
  id: "c1",
  brandId: "b1",
  startDate: new Date("2026-09-01T00:00:00Z"),
  endDate: new Date("2026-11-29T00:00:00Z"),
};
const ITEM = {
  id: "i1",
  calendarId: "c1",
  date: new Date("2026-10-15T00:00:00Z"),
};

function form(overrides: Record<string, unknown> = {}) {
  return {
    title: "Sale announcement",
    brief: null,
    caption: "50% off, today only.",
    notes: "Confirm stock first",
    date: "2026-10-15",
    time: "10:00 AM",
    platform: "Instagram",
    contentType: "Post",
    designRequired: false,
    designType: null,
    dimensions: null,
    ...overrides,
  };
}

beforeEach(() => {
  /* resetAllMocks, not clearAllMocks: clear wipes call history but LEAVES
     implementations, so a mockRejectedValue set by one test leaks into every
     later one and the suite becomes order-dependent. */
  vi.resetAllMocks();
  revalidatePath.mockImplementation(() => {});
  requireBrand.mockResolvedValue({ brand: BRAND });
  getCalendarById.mockResolvedValue(CALENDAR);
  getCalendarItemById.mockResolvedValue(ITEM);
  nextSortOrderForDate.mockResolvedValue(3);
  createCalendarItem.mockResolvedValue({ id: "new-1" });
  updateCalendarItem.mockResolvedValue({ id: "i1" });
  updateCalendarItemStatus.mockResolvedValue({ id: "i1" });
  deleteCalendarItem.mockResolvedValue({ id: "i1" });
});

describe("createCalendarItemAction", () => {
  it("stamps source=manual and status=draft regardless of the input", () => {
    return createCalendarItemAction(
      "c1",
      form({ source: "ai", status: "published" } as never),
    ).then((res) => {
      expect(res).toEqual({ ok: true, id: "new-1" });
      const row = createCalendarItem.mock.calls[0][0];
      expect(row.source).toBe("manual");
      expect(row.status).toBe("draft");
      expect(row.calendarId).toBe("c1");
    });
  });

  it("stores the date as UTC midnight", async () => {
    await createCalendarItemAction("c1", form());
    const row = createCalendarItem.mock.calls[0][0];
    expect(row.date.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  it("appends after the existing items on that day", async () => {
    await createCalendarItemAction("c1", form());
    expect(nextSortOrderForDate).toHaveBeenCalledWith(
      "c1",
      new Date("2026-10-15T00:00:00Z"),
    );
    expect(createCalendarItem.mock.calls[0][0].sortOrder).toBe(3);
  });

  it("refuses a calendar belonging to another brand, without writing", async () => {
    getCalendarById.mockResolvedValue(OTHER_BRAND_CALENDAR);
    const res = await createCalendarItemAction("c9", form());
    expect(res).toEqual({ ok: false, error: "Calendar not found" });
    expect(createCalendarItem).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a calendar that does not exist, without writing", async () => {
    getCalendarById.mockResolvedValue(null);
    const res = await createCalendarItemAction("nope", form());
    expect(res).toEqual({ ok: false, error: "Calendar not found" });
    expect(createCalendarItem).not.toHaveBeenCalled();
  });

  it("rejects an empty title before touching the database", async () => {
    const res = await createCalendarItemAction("c1", form({ title: "   " }));
    expect(res).toEqual({ ok: false, error: "Title is required" });
    expect(getCalendarById).not.toHaveBeenCalled();
    expect(createCalendarItem).not.toHaveBeenCalled();
  });

  it("rejects a missing platform and a malformed date", async () => {
    expect(
      await createCalendarItemAction("c1", form({ platform: "" })),
    ).toEqual({ ok: false, error: "Platform is required" });
    expect(
      await createCalendarItemAction("c1", form({ date: "15/10/2026" })),
    ).toEqual({ ok: false, error: "Invalid date" });
  });

  it("normalizes blank optional text to null", async () => {
    await createCalendarItemAction(
      "c1",
      form({ caption: "", notes: "", time: "" }),
    );
    const row = createCalendarItem.mock.calls[0][0];
    expect(row.caption).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.time).toBeNull();
  });

  it("leaves the window alone for a date already inside it", async () => {
    await createCalendarItemAction("c1", form({ date: "2026-10-15" }));
    expect(widenCalendarWindow).not.toHaveBeenCalled();
  });

  it("widens the window for a date past the end", async () => {
    await createCalendarItemAction("c1", form({ date: "2026-12-05" }));
    expect(widenCalendarWindow).toHaveBeenCalledWith(
      "c1",
      new Date("2026-12-05T00:00:00Z"),
    );
  });

  it("widens the window for a date before the start", async () => {
    await createCalendarItemAction("c1", form({ date: "2026-08-20" }));
    expect(widenCalendarWindow).toHaveBeenCalledWith(
      "c1",
      new Date("2026-08-20T00:00:00Z"),
    );
  });

  // Widening after the insert could commit the item and still report failure,
  // and the user would resubmit into a duplicate.
  it("widens the window BEFORE writing the item", async () => {
    const order: string[] = [];
    widenCalendarWindow.mockImplementation(() => {
      order.push("widen");
    });
    createCalendarItem.mockImplementation(() => {
      order.push("insert");
      return { id: "new-1" };
    });
    await createCalendarItemAction("c1", form({ date: "2026-12-05" }));
    expect(order).toEqual(["widen", "insert"]);
  });

  it("writes nothing when the window widen fails", async () => {
    widenCalendarWindow.mockRejectedValue(new Error("pool timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createCalendarItemAction(
      "c1",
      form({ date: "2026-12-05" }),
    );
    expect(res).toEqual({ ok: false, error: "Could not add the entry" });
    expect(createCalendarItem).not.toHaveBeenCalled();
  });

  it("rejects a date that does not exist, before touching the database", async () => {
    for (const date of ["2026-02-31", "2026-13-01", "2026-09-32"]) {
      const res = await createCalendarItemAction("c1", form({ date }));
      expect(res).toEqual({ ok: false, error: "That date does not exist" });
    }
    expect(createCalendarItem).not.toHaveBeenCalled();
  });

  it("revalidates the calendar route on success", async () => {
    await createCalendarItemAction("c1", form());
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
  });

  /* revalidatePath throws inside a cache scope. Reporting failure for a row
     that is already committed makes the user resubmit into a duplicate. */
  it("still reports success when revalidation throws after the write", async () => {
    revalidatePath.mockImplementation(() => {
      throw new Error("cache scope");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createCalendarItemAction("c1", form());
    expect(res).toEqual({ ok: true, id: "new-1" });
    expect(createCalendarItem).toHaveBeenCalledTimes(1);
  });

  it.each(["0202-09-12", "9999-12-31", "2020-01-01"])(
    "rejects the out-of-bounds year in %s without writing",
    async (date) => {
      const res = await createCalendarItemAction("c1", form({ date }));
      expect(res).toEqual({
        ok: false,
        error: "Pick a date within 5 years",
      });
      expect(createCalendarItem).not.toHaveBeenCalled();
      expect(widenCalendarWindow).not.toHaveBeenCalled();
    },
  );

  it("reports a failure instead of throwing when the insert blows up", async () => {
    createCalendarItem.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createCalendarItemAction("c1", form());
    expect(res).toEqual({ ok: false, error: "Could not add the entry" });
  });
});

describe("updateCalendarItemAction", () => {
  it("saves caption and notes", async () => {
    const res = await updateCalendarItemAction("i1", form());
    expect(res).toEqual({ ok: true });
    const patch = updateCalendarItem.mock.calls[0][1];
    expect(patch.caption).toBe("50% off, today only.");
    expect(patch.notes).toBe("Confirm stock first");
  });

  it("never lets the client rewrite provenance", async () => {
    await updateCalendarItemAction("i1", form({ source: "ai" } as never));
    expect(updateCalendarItem.mock.calls[0][1]).not.toHaveProperty("source");
  });

  it("refuses an item on another brand's calendar, without writing", async () => {
    getCalendarById.mockResolvedValue(OTHER_BRAND_CALENDAR);
    const res = await updateCalendarItemAction("i1", form());
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(updateCalendarItem).not.toHaveBeenCalled();
  });

  it("refuses an item that does not exist", async () => {
    getCalendarItemById.mockResolvedValue(null);
    const res = await updateCalendarItemAction("gone", form());
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(updateCalendarItem).not.toHaveBeenCalled();
  });

  it("widens the window when an edit moves an item out of range", async () => {
    await updateCalendarItemAction("i1", form({ date: "2026-12-05" }));
    expect(widenCalendarWindow).toHaveBeenCalledWith(
      "c1",
      new Date("2026-12-05T00:00:00Z"),
    );
  });

  it("rejects a date that does not exist", async () => {
    const res = await updateCalendarItemAction(
      "i1",
      form({ date: "2026-02-31" }),
    );
    expect(res).toEqual({ ok: false, error: "That date does not exist" });
    expect(updateCalendarItem).not.toHaveBeenCalled();
  });

  it("rejects an out-of-bounds year when the date is being moved", async () => {
    const res = await updateCalendarItemAction(
      "i1",
      form({ date: "0202-09-12" }),
    );
    expect(res).toEqual({ ok: false, error: "Pick a date within 5 years" });
    expect(updateCalendarItem).not.toHaveBeenCalled();
    expect(widenCalendarWindow).not.toHaveBeenCalled();
  });

  it("rejects a far-future move on an item that is currently in bounds", async () => {
    const res = await updateCalendarItemAction(
      "i1",
      form({ date: "9999-12-31" }),
    );
    expect(res).toEqual({ ok: false, error: "Pick a date within 5 years" });
    expect(updateCalendarItem).not.toHaveBeenCalled();
  });

  /* The bound guards a typo that MOVES the window. Applying it to an unchanged
     date would make an item saved today unsavable in five years — the user
     would be told to fix a date while editing a caption. */
  it("saves an unchanged out-of-bounds date, so old items stay editable", async () => {
    getCalendarItemById.mockResolvedValue({
      ...ITEM,
      date: new Date("2019-01-01T00:00:00Z"),
    });
    const res = await updateCalendarItemAction(
      "i1",
      form({ date: "2019-01-01", title: "Renamed" }),
    );
    expect(res).toEqual({ ok: true });
    expect(updateCalendarItem.mock.calls[0][1].title).toBe("Renamed");
  });

  it("tolerates a stored date carrying a time component", async () => {
    getCalendarItemById.mockResolvedValue({
      ...ITEM,
      date: new Date("2019-01-01T09:30:00Z"),
    });
    const res = await updateCalendarItemAction(
      "i1",
      form({ date: "2019-01-01" }),
    );
    expect(res).toEqual({ ok: true });
  });
});

/**
 * requireBrand() signals an expired session by throwing NEXT_REDIRECT. An
 * action that catches it turns "go to /login" into a permanent "Could not
 * save" toast — the user retries forever and never re-authenticates.
 */
describe("updateCalendarItemStatusAction", () => {
  it("updates the status of an owned item", async () => {
    const res = await updateCalendarItemStatusAction("i1", "ready");
    expect(res).toEqual({ ok: true });
    expect(updateCalendarItemStatus).toHaveBeenCalledWith("i1", "ready");
  });

  it("refuses an item on another brand's calendar, without writing", async () => {
    getCalendarById.mockResolvedValue(OTHER_BRAND_CALENDAR);
    const res = await updateCalendarItemStatusAction("i1", "published");
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(updateCalendarItemStatus).not.toHaveBeenCalled();
  });

  it("refuses an item that does not exist", async () => {
    getCalendarItemById.mockResolvedValue(null);
    const res = await updateCalendarItemStatusAction("gone", "ready");
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(updateCalendarItemStatus).not.toHaveBeenCalled();
  });
});

describe("expired session", () => {
  function nextRedirect() {
    const err = new Error("NEXT_REDIRECT") as Error & { digest: string };
    err.digest = "NEXT_REDIRECT;replace;/login;307;";
    return err;
  }

  beforeEach(() => {
    requireBrand.mockRejectedValue(nextRedirect());
  });

  it.each([
    ["create", () => createCalendarItemAction("c1", form())],
    ["update", () => updateCalendarItemAction("i1", form())],
    ["delete", () => deleteCalendarItemAction("i1")],
    ["status", () => updateCalendarItemStatusAction("i1", "ready")],
  ])("%s rethrows the redirect instead of swallowing it", async (_n, run) => {
    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    expect(createCalendarItem).not.toHaveBeenCalled();
    expect(updateCalendarItem).not.toHaveBeenCalled();
    expect(deleteCalendarItem).not.toHaveBeenCalled();
  });
});

/*
 * A write that matched zero rows means the item vanished between the ownership
 * read and the write. Reporting success there tells the user their edit saved,
 * clears the drawer, and discards the only copy of what they typed.
 */
describe("writes that match no rows", () => {
  it("update reports failure rather than a phantom success", async () => {
    updateCalendarItem.mockResolvedValue(undefined);
    const res = await updateCalendarItemAction("i1", form());
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("delete reports failure rather than a phantom success", async () => {
    deleteCalendarItem.mockResolvedValue(null);
    const res = await deleteCalendarItemAction("i1");
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("status reports failure rather than a phantom success", async () => {
    updateCalendarItemStatus.mockResolvedValue(undefined);
    const res = await updateCalendarItemStatusAction("i1", "ready");
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteCalendarItemAction", () => {
  it("deletes an owned item and revalidates", async () => {
    const res = await deleteCalendarItemAction("i1");
    expect(res).toEqual({ ok: true });
    expect(deleteCalendarItem).toHaveBeenCalledWith("i1");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
  });

  it("refuses an item on another brand's calendar, without deleting", async () => {
    getCalendarById.mockResolvedValue(OTHER_BRAND_CALENDAR);
    const res = await deleteCalendarItemAction("i1");
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(deleteCalendarItem).not.toHaveBeenCalled();
  });

  it("refuses an item that does not exist", async () => {
    getCalendarItemById.mockResolvedValue(null);
    const res = await deleteCalendarItemAction("gone");
    expect(res).toEqual({ ok: false, error: "Item not found" });
    expect(deleteCalendarItem).not.toHaveBeenCalled();
  });

  it("still reports success when revalidation throws after the delete", async () => {
    revalidatePath.mockImplementation(() => {
      throw new Error("cache scope");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await deleteCalendarItemAction("i1");
    expect(res).toEqual({ ok: true });
    expect(deleteCalendarItem).toHaveBeenCalledTimes(1);
  });
});
