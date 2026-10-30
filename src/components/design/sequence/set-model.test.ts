import { describe, expect, it } from "vitest";
import type { SerializedFrame } from "@/lib/design/sequence/contract";
import { BRAND, frameRow, frameRows, SET, singleRow } from "./fixtures";
import {
  buildSet,
  coverOf,
  frameSize,
  frameState,
  groupGallery,
  isBuilding,
  markStalled,
  mergeSets,
  readyFrames,
  renderingIds,
  roleLabel,
  setDownloadUrl,
  swapFrame,
} from "./set-model";

describe("buildSet", () => {
  it("puts the frames in index order whatever order the rows came in", () => {
    const rows = frameRows(5).reverse();
    const set = buildSet(BRAND, rows);
    expect(set?.frames.map((f) => f.generation?.id)).toEqual([
      "f0",
      "f1",
      "f2",
      "f3",
      "f4",
    ]);
    expect(set?.frames.map((f) => f.role)).toEqual([
      "hook",
      "body",
      "body",
      "body",
      "cta",
    ]);
    expect(set?.kind).toBe("carousel");
    expect(set?.setId).toBe(SET);
  });

  /* A carousel is N frames, not "the rows that happened to come back": a
     frame the job never wrote still has its place, so the viewer can say it
     is missing instead of showing a shorter carousel. */
  it("keeps a place for every index up to the job's frame count", () => {
    const rows = [frameRow(0), frameRow(2), frameRow(4)];
    const set = buildSet(BRAND, rows, { frameCount: 5 });
    expect(set?.frames).toHaveLength(5);
    expect(set?.frames[1]?.generation).toBeNull();
    expect(set?.frames[1] && frameState(set.frames[1])).toBe("missing");
    expect(set?.frames[1]?.role).toBe("body");
    expect(set?.frames[4]?.role).toBe("cta");
  });

  it("shows the newest succeeded row where a frame was regenerated", () => {
    const old = frameRow(2);
    const replacement = frameRow(2, {
      id: "f2-new",
      createdAt: "2026-10-30T11:00:00.000Z",
    });
    const failedRetry = frameRow(2, {
      id: "f2-failed",
      status: "failed",
      createdAt: "2026-10-30T12:00:00.000Z",
    });
    const set = buildSet(BRAND, [
      ...frameRows(5),
      replacement,
      failedRetry,
      old,
    ]);
    expect(set?.frames[2]?.generation?.id).toBe("f2-new");
  });

  it("keeps a failed frame in its place", () => {
    const rows = frameRows(3);
    rows[1] = frameRow(1, { count: 3, status: "failed", url: null });
    const set = buildSet(BRAND, rows);
    expect(set?.frames.map((f) => frameState(f))).toEqual([
      "ready",
      "failed",
      "ready",
    ]);
    expect(set && readyFrames(set).map((g) => g.id)).toEqual(["f0", "f2"]);
  });

  it("reads a presentation from its design type and draws it 16:9", () => {
    const rows = frameRows(3).map((r) => ({
      ...r,
      designType: "Pitch deck presentation",
      width: null,
      height: null,
    }));
    const set = buildSet(BRAND, rows);
    expect(set?.kind).toBe("presentation");
    expect(set && frameSize(set)).toEqual({ width: 1920, height: 1080 });
  });

  it("returns null for rows that are not frames", () => {
    expect(buildSet(BRAND, [singleRow("s1")])).toBeNull();
  });
});

describe("swapFrame", () => {
  it("replaces one frame in place and leaves the rest untouched", () => {
    const set = buildSet(BRAND, frameRows(5));
    if (!set) throw new Error("no set");
    const next = swapFrame(
      set,
      frameRow(3, { id: "f3-new", headline: "Edited" }),
    );
    expect(next.frames.map((f) => f.generation?.id)).toEqual([
      "f0",
      "f1",
      "f2",
      "f3-new",
      "f4",
    ]);
    for (const i of [0, 1, 2, 4]) {
      expect(next.frames[i]).toBe(set.frames[i]);
    }
  });

  it("ignores a row from another set", () => {
    const set = buildSet(BRAND, frameRows(3));
    if (!set) throw new Error("no set");
    const stranger = frameRow(1, { id: "x" });
    stranger.frame = { ...(stranger.frame as SerializedFrame), setId: "other" };
    expect(swapFrame(set, stranger)).toBe(set);
  });
});

describe("labels and links", () => {
  it("names roles by what the frame does in that kind of set", () => {
    expect(
      (["hook", "body", "cta"] as const).map((r) => roleLabel("carousel", r)),
    ).toEqual(["Hook", "Point", "Action"]);
    expect(
      (["hook", "body", "cta"] as const).map((r) =>
        roleLabel("presentation", r),
      ),
    ).toEqual(["Title", "Slide", "Close"]);
  });

  it("points downloads at the set route with the brand and format", () => {
    const set = buildSet(BRAND, frameRows(2));
    if (!set) throw new Error("no set");
    expect(setDownloadUrl(set, "zip")).toBe(
      `/api/design/sets/${SET}/download?brandId=${BRAND}&format=zip`,
    );
    expect(setDownloadUrl(set, "pdf")).toBe(
      `/api/design/sets/${SET}/download?brandId=${BRAND}&format=pdf`,
    );
  });

  it("covers a set with its hook, or its first frame that rendered", () => {
    const set = buildSet(BRAND, frameRows(3));
    expect(set && coverOf(set)?.id).toBe("f0");
    const rows = frameRows(3);
    rows[0] = frameRow(0, { count: 3, status: "failed", url: null });
    const broken = buildSet(BRAND, rows);
    expect(broken && coverOf(broken)?.id).toBe("f1");
  });
});

describe("groupGallery", () => {
  it("folds a set into one item where its newest row was, singles untouched", () => {
    const history = [
      singleRow("s1"),
      ...frameRows(5),
      singleRow("s2"),
      singleRow("s3"),
    ];
    const items = groupGallery(BRAND, history);
    expect(
      items.map((i) =>
        i.type === "set" ? `set:${i.set.setId}` : i.generation.id,
      ),
    ).toEqual(["s1", `set:${SET}`, "s2", "s3"]);
    const set = items[1];
    expect(set?.type === "set" && set.set.frames).toHaveLength(5);
    expect(items[0]).toEqual({ type: "design", generation: history[0] });
  });

  it("passes single designs through exactly as before", () => {
    const history = [singleRow("a"), singleRow("b")];
    expect(groupGallery(BRAND, history)).toEqual(
      history.map((generation) => ({ type: "design", generation })),
    );
  });

  it("keeps two sets apart", () => {
    const other = frameRows(2).map((r) => ({
      ...r,
      id: `o-${r.id}`,
      frame: { ...(r.frame as SerializedFrame), setId: "set-2" },
    }));
    const items = groupGallery(BRAND, [...frameRows(3), ...other]);
    expect(items.map((i) => i.type === "set" && i.set.frames.length)).toEqual([
      3, 2,
    ]);
  });

  /* Round 3 M4: a carousel that failed outright, or is still being made
     elsewhere, used to vanish from the grid with no error and no retry. */
  it("keeps a set with nothing to put on its cover", () => {
    for (const status of ["failed", "pending"] as const) {
      const rows = frameRows(2).map((r) => ({ ...r, status, url: null }));
      const items = groupGallery(BRAND, rows);
      expect(items).toHaveLength(1);
      const [item] = items;
      expect(item?.type === "set" && coverOf(item.set)).toBeNull();
    }
  });
});

describe("a set still being made", () => {
  const building = () => {
    const rows = frameRows(5);
    rows[3] = frameRow(3, { status: "pending", url: null });
    rows[4] = frameRow(4, { status: "pending", url: null });
    return buildSet(BRAND, rows) as NonNullable<ReturnType<typeof buildSet>>;
  };

  it("knows which frames are still on their way", () => {
    expect(isBuilding(building())).toBe(true);
    expect(renderingIds(building())).toEqual(["f3", "f4"]);
    const done = buildSet(BRAND, frameRows(5));
    expect(done && isBuilding(done)).toBe(false);
  });

  it("shows stalled frames as failed, and leaves the rest alone", () => {
    const stalled = markStalled(building());
    expect(stalled.frames.map(frameState)).toEqual([
      "ready",
      "ready",
      "ready",
      "failed",
      "failed",
    ]);
    expect(isBuilding(stalled)).toBe(false);
    expect(stalled.frames[0]?.stalled).toBeUndefined();
    const done = buildSet(BRAND, frameRows(5));
    expect(done && markStalled(done)).toBe(done);
  });
});

describe("mergeSets", () => {
  it("takes the fresher read of a row it already holds", () => {
    const rows = frameRows(5);
    rows[3] = frameRow(3, { status: "pending", url: null });
    const held = buildSet(BRAND, rows) as NonNullable<
      ReturnType<typeof buildSet>
    >;
    const incoming = buildSet(BRAND, frameRows(5)) as typeof held;
    expect(mergeSets(held, incoming).frames[3]?.generation?.status).toBe(
      "succeeded",
    );
  });

  /* A frame regenerated in the open viewer must not be undone by a grid
     read taken before its new row existed. */
  it("keeps a frame swapped in here over an older read of the set", () => {
    const base = buildSet(BRAND, frameRows(5)) as NonNullable<
      ReturnType<typeof buildSet>
    >;
    const held = swapFrame(
      base,
      frameRow(2, { id: "f2-new", createdAt: "2026-10-30T12:00:00.000Z" }),
    );
    expect(mergeSets(held, base).frames[2]?.generation?.id).toBe("f2-new");
  });

  it("carries the stalled mark of the read it takes", () => {
    const rows = frameRows(5);
    rows[4] = frameRow(4, { status: "pending", url: null });
    const held = buildSet(BRAND, rows) as NonNullable<
      ReturnType<typeof buildSet>
    >;
    expect(mergeSets(held, markStalled(held)).frames[4]?.stalled).toBe(true);
  });
});
