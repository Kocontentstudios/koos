import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadAdminScope } from "@/lib/admin/scope-params";
import { type BrandListRow, BrandsTable } from "./brands-table";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";

function brand(over: Partial<BrandListRow> = {}): BrandListRow {
  return {
    id: BRAND,
    name: "Acme Co",
    ownerEmail: "cara@koos.test",
    workspaceName: "Studio",
    status: "active",
    completionPercentage: 80,
    ticketCount: 64,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...over,
  };
}

const countLink = () =>
  screen.getAllByRole("link").find((a) => /^64/.test(a.textContent ?? ""));

/* FEAT-006: "Clicking the ticket count should open a list of that brand's
   tickets, while keeping the existing clickable brand-name link". */
describe("the brand ticket count opens that brand's tickets", () => {
  it("links the count", () => {
    render(<BrandsTable brands={[brand()]} />);
    expect(countLink()?.getAttribute("href")).toContain(`brand=${BRAND}`);
  });

  /* listBrandsForAdmin counts EVERY ticket including drafts, and the queue's
     default view excludes drafts and delivered work — so anything narrower
     opens a list shorter than the number just clicked. */
  it("opens a view that can contain every ticket it counted", () => {
    render(<BrandsTable brands={[brand()]} />);
    const href = countLink()?.getAttribute("href") ?? "";
    const scope = loadAdminScope(new URLSearchParams(href.split("?")[1] ?? ""));
    expect(scope.view).toBe("all");
    expect(scope.brand).toBe(BRAND);
  });

  /* Nine identical "64"s in a column tell a screen reader nothing about which
     brand each belongs to. */
  it("names the brand in the link's accessible name", () => {
    render(<BrandsTable brands={[brand()]} />);
    expect(countLink()?.textContent).toContain("Acme Co");
  });

  /* Both links mention the brand — the name link, and the count's sr-only
     text — so they are told apart by destination. */
  it("keeps the brand-name link that opens brand details", () => {
    render(<BrandsTable brands={[brand()]} />);
    const detail = screen
      .getAllByRole("link")
      .find((a) => (a.getAttribute("href") ?? "").startsWith("/admin/brands/"));
    expect(detail?.getAttribute("href")).toBe(`/admin/brands/${BRAND}`);
    expect(detail?.textContent).toContain("Acme Co");
  });

  /* A zero is not a link to an empty list. */
  it("does not link a count of zero", () => {
    render(<BrandsTable brands={[brand({ ticketCount: 0 })]} />);
    expect(
      screen
        .getAllByRole("link")
        .some((a) => /tickets for/.test(a.textContent ?? "")),
    ).toBe(false);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

describe("the existing search still works", () => {
  it("renders every brand it is given", () => {
    render(
      <BrandsTable
        brands={[
          brand(),
          brand({ id: "b2", name: "Lagos Loom", ticketCount: 3 }),
        ]}
      />,
    );
    expect(screen.getByText("Lagos Loom")).toBeInTheDocument();
  });
});
