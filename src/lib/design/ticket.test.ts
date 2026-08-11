import { describe, expect, it } from "vitest";
import {
  canRequestRevision,
  deliverablesZipName,
  formatTicketNumber,
  groupDeliverablesByVersion,
  latestVersion,
  MAX_DELIVERY_ROUNDS,
} from "./ticket";

function deliverable(version: number, day: number, slideIndex = 0) {
  return {
    id: `d${version}-${day}-${slideIndex}`,
    version,
    slideIndex,
    createdAt: new Date(Date.UTC(2026, 7, day)),
  };
}

describe("formatTicketNumber", () => {
  it("pads to five digits", () => {
    expect(formatTicketNumber(124)).toBe("DT-00124");
  });

  it("never truncates a number wider than the padding", () => {
    expect(formatTicketNumber(1234567)).toBe("DT-1234567");
  });
});

describe("deliverablesZipName", () => {
  it("omits the version segment when none is given", () => {
    expect(deliverablesZipName(124)).toBe("DT-00124-deliverables.zip");
  });

  it("includes the version segment when given", () => {
    expect(deliverablesZipName(124, 2)).toBe("DT-00124-v2-deliverables.zip");
  });
});

describe("groupDeliverablesByVersion", () => {
  it("returns nothing for an empty list", () => {
    expect(groupDeliverablesByVersion([])).toEqual([]);
  });

  it("groups a legacy single-version batch even with duplicate slide indexes", () => {
    // Pre-versioning tickets that went through a manual re-upload collapsed into
    // V1, so colliding slideIndex values inside one round are expected.
    const rows = [
      deliverable(1, 1, 0),
      deliverable(1, 1, 1),
      deliverable(1, 3, 0),
    ];

    const groups = groupDeliverablesByVersion(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].version).toBe(1);
    expect(groups[0].items).toHaveLength(3);
  });

  it("orders rounds newest first regardless of input order", () => {
    const rows = [deliverable(2, 5), deliverable(1, 1), deliverable(3, 9)];

    expect(groupDeliverablesByVersion(rows).map((g) => g.version)).toEqual([
      3, 2, 1,
    ]);
  });

  it("dates each round from its earliest file", () => {
    const rows = [deliverable(1, 7, 0), deliverable(1, 2, 1)];

    expect(groupDeliverablesByVersion(rows)[0].deliveredAt).toEqual(
      new Date(Date.UTC(2026, 7, 2)),
    );
  });

  it("keeps incoming item order within a round", () => {
    const rows = [deliverable(1, 1, 0), deliverable(1, 1, 1)];

    expect(groupDeliverablesByVersion(rows)[0].items.map((i) => i.id)).toEqual([
      "d1-1-0",
      "d1-1-1",
    ]);
  });
});

describe("latestVersion", () => {
  it("returns null when nothing is delivered", () => {
    expect(latestVersion([])).toBeNull();
  });

  it("returns the highest round", () => {
    expect(
      latestVersion([{ version: 1 }, { version: 3 }, { version: 2 }]),
    ).toBe(3);
  });
});

describe("canRequestRevision", () => {
  it("allows a revision on every round before the last", () => {
    for (let v = 1; v < MAX_DELIVERY_ROUNDS; v++) {
      expect(canRequestRevision(v)).toBe(true);
    }
  });

  it("closes the loop on the final round", () => {
    expect(canRequestRevision(MAX_DELIVERY_ROUNDS)).toBe(false);
  });

  // A staff correction can push past the cap; the loop stays shut.
  it("stays closed beyond the cap", () => {
    expect(canRequestRevision(MAX_DELIVERY_ROUNDS + 1)).toBe(false);
  });

  it("offers nothing before anything is delivered", () => {
    expect(canRequestRevision(null)).toBe(false);
  });
});
