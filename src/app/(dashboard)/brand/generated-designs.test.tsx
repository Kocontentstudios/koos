import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratedDesigns } from "./generated-designs";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function generation(overrides = {}) {
  return {
    id: "g1",
    url: "https://r2.example/generated/g1.png",
    renderer: "composite" as const,
    headline: "Launch week",
    designType: "Instagram post",
    width: 1080,
    height: 1350,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* The ticket in one sentence: clicking a card opens a preview with a Download
   button. Both halves were tested in isolation and the wiring between them was
   not, so the modal could be deleted from this file with everything green. */
describe("GeneratedDesigns", () => {
  it("opens the preview for the card that was clicked", async () => {
    render(
      <GeneratedDesigns
        brandId="b1"
        generations={[
          generation(),
          generation({ id: "g2", headline: "Second drop" }),
        ]}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview Second drop" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "/api/design/generations/g2/download",
    );
  });

  /* Viewing an existing design: there is nothing to regenerate here. */
  it("offers no Regenerate when viewing from the grid", async () => {
    render(<GeneratedDesigns brandId="b1" generations={[generation()]} />);
    await userEvent.click(screen.getByRole("button", { name: /preview/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("renders nothing at all when the brand has no designs", () => {
    const { container } = render(
      <GeneratedDesigns brandId="b1" generations={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
