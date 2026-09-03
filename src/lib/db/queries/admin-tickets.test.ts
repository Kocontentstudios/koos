import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));

import { DEFAULT_SCOPE } from "@/lib/admin/scope-params";
import {
  countAdminTickets,
  DEFAULT_PAGE_SIZE,
  getWorkloadForDesigner,
  listAdminTickets,
  MAX_PAGE_SIZE,
} from "./admin-tickets";

/* SQL correctness is not provable here — the gate lane has no database. What
   is provable, and what actually broke in this area before, is that the
   translator is reachable, bounded, and re-exported. The predicate it encodes
   is tested without a database in scope.test.ts. */
describe("admin ticket queries", () => {
  it("exports callable query functions", () => {
    for (const fn of [
      listAdminTickets,
      countAdminTickets,
      getWorkloadForDesigner,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("keeps a hard ceiling above the page size", () => {
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    expect(MAX_PAGE_SIZE).toBeLessThanOrEqual(500);
  });

  it("takes the shared scope shape", () => {
    expect(DEFAULT_SCOPE.view).toBe("all");
    expect(DEFAULT_SCOPE.page).toBe(1);
  });
});
