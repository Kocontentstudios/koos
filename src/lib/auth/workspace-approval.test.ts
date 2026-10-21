import { describe, expect, it } from "vitest";
import { workspaceAccessStatusEnum } from "@/lib/db/schema";
import { ROLES } from "./roles";
import {
  isWorkspaceAccessStatus,
  isWorkspaceOpen,
  WORKSPACE_ACCESS_STATUSES,
  WORKSPACE_PENDING_CODE,
  WORKSPACE_PENDING_ERROR,
  workspacePendingResponse,
} from "./workspace-approval";

describe("isWorkspaceOpen", () => {
  it("opens an approved workspace to every role", () => {
    for (const role of ROLES) {
      expect(isWorkspaceOpen("approved", role)).toBe(true);
    }
  });

  it("keeps a pending workspace closed to a client", () => {
    expect(isWorkspaceOpen("pending", "user")).toBe(false);
  });

  it("lets staff through a pending workspace", () => {
    expect(isWorkspaceOpen("pending", "designer")).toBe(true);
    expect(isWorkspaceOpen("pending", "admin")).toBe(true);
  });

  /* A role this build has not heard of must fail closed: the gate exists to
     stop unpaid AI spend, and an unknown role is not evidence of payment. */
  it("keeps a pending workspace closed to an unknown role", () => {
    expect(isWorkspaceOpen("pending", "superuser")).toBe(false);
    expect(isWorkspaceOpen("pending", "")).toBe(false);
  });
});

describe("WORKSPACE_ACCESS_STATUSES", () => {
  it("matches the database enum exactly", () => {
    expect([...WORKSPACE_ACCESS_STATUSES]).toEqual(
      workspaceAccessStatusEnum.enumValues,
    );
  });

  it("recognises only real statuses", () => {
    expect(isWorkspaceAccessStatus("pending")).toBe(true);
    expect(isWorkspaceAccessStatus("approved")).toBe(true);
    expect(isWorkspaceAccessStatus("revoked")).toBe(false);
    expect(isWorkspaceAccessStatus(undefined)).toBe(false);
  });
});

describe("workspacePendingResponse", () => {
  it("is a 403 carrying a code a client can branch on", async () => {
    const res = workspacePendingResponse();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: WORKSPACE_PENDING_ERROR,
      code: WORKSPACE_PENDING_CODE,
    });
  });
});
