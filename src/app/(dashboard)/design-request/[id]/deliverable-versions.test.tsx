import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { groupDeliverablesByVersion } from "@/lib/design/ticket";
import { DeliverableVersions } from "./deliverable-versions";

function deliverable(
  id: string,
  fileName: string,
  version: number,
  day: number,
) {
  return {
    id,
    fileName,
    version,
    createdAt: new Date(Date.UTC(2026, 7, day)),
  };
}

function renderVersions(
  rows: ReturnType<typeof deliverable>[],
  canDownload = true,
) {
  return render(
    <DeliverableVersions
      ticketId="t-1"
      groups={groupDeliverablesByVersion(rows)}
      canDownload={canDownload}
    />,
  );
}

describe("DeliverableVersions", () => {
  it("renders nothing before anything is delivered", () => {
    const { container } = renderVersions([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists rounds newest first", () => {
    renderVersions([
      deliverable("a", "v1.png", 1, 1),
      deliverable("b", "v2.png", 2, 5),
      deliverable("c", "v3.png", 3, 9),
    ]);

    const headings = screen.getAllByText(/^V\d$/).map((el) => el.textContent);
    expect(headings).toEqual(["V3", "V2", "V1"]);
  });

  it("marks only the newest round as latest", () => {
    renderVersions([
      deliverable("a", "v1.png", 1, 1),
      deliverable("b", "v2.png", 2, 5),
    ]);
    expect(screen.getAllByText("Latest")).toHaveLength(1);
  });

  it("does not label a lone round as latest", () => {
    renderVersions([deliverable("a", "v1.png", 1, 1)]);
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
  });

  // Superseded rounds stay fully downloadable — that's the audit trail the
  // client relies on when a revision goes the wrong way.
  it("keeps every round downloadable, not just the latest", () => {
    renderVersions([
      deliverable("a", "old.png", 1, 1),
      deliverable("b", "new.png", 2, 5),
    ]);

    const zips = screen
      .getAllByRole("link", { name: /download all \(zip\)/i })
      .map((el) => el.getAttribute("href"));
    expect(zips).toEqual([
      "/api/design-tickets/t-1/deliverables/zip?version=2",
      "/api/design-tickets/t-1/deliverables/zip?version=1",
    ]);

    for (const id of ["a", "b"]) {
      expect(
        document.querySelector(
          `a[href="/api/design-tickets/t-1/deliverables/${id}?disposition=attachment"]`,
        ),
      ).not.toBeNull();
    }
  });

  it("previews images inline and labels them with their round", () => {
    renderVersions([deliverable("a", "cover.png", 2, 5)]);
    const img = screen.getByRole("img", { name: /cover\.png \(version 2\)/i });
    expect(img).toHaveAttribute(
      "src",
      "/api/design-tickets/t-1/deliverables/a?disposition=inline",
    );
  });

  it("omits a preview for a non-image deliverable", () => {
    renderVersions([deliverable("a", "brand-guide.pdf", 1, 1)]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("brand-guide.pdf")).toBeInTheDocument();
  });

  describe("before the client is satisfied", () => {
    it("explains why downloads are locked instead of showing a dead button", () => {
      renderVersions([deliverable("a", "cover.png", 1, 1)], false);
      expect(screen.getByText(/downloads unlock/i)).toBeInTheDocument();
    });

    it("offers View instead of Download, and no zip link", () => {
      renderVersions([deliverable("a", "cover.png", 1, 1)], false);

      expect(screen.getByRole("link", { name: /view/i })).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /^download$/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /download all \(zip\)/i }),
      ).not.toBeInTheDocument();
    });

    // Judging the work has to stay possible — only saving it to disk waits.
    it("still previews the design full-size", () => {
      renderVersions([deliverable("a", "cover.png", 1, 1)], false);
      expect(
        screen.getByRole("img", { name: /cover\.png \(version 1\)/i }),
      ).toHaveAttribute(
        "src",
        "/api/design-tickets/t-1/deliverables/a?disposition=inline",
      );
    });

    it("drops the lock notice once approved", () => {
      renderVersions([deliverable("a", "cover.png", 1, 1)], true);
      expect(screen.queryByText(/downloads unlock/i)).not.toBeInTheDocument();
    });
  });

  it("groups every file of a round under one heading", () => {
    renderVersions([
      deliverable("a", "slide-1.png", 1, 1),
      deliverable("b", "slide-2.png", 1, 1),
    ]);

    const round = screen.getByText("V1").closest("div")?.parentElement
      ?.parentElement as HTMLElement;
    expect(within(round).getByText("slide-1.png")).toBeInTheDocument();
    expect(within(round).getByText("slide-2.png")).toBeInTheDocument();
  });
});
