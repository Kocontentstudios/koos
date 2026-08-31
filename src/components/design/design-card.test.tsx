import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignCard } from "./design-card";

const generation = {
  id: "g1",
  url: "https://r2.example/generated/g1.png",
  renderer: "composite" as const,
  headline: "Launch week",
  designType: "Instagram post",
  width: 1080,
  height: 1350,
} as never;

describe("DesignCard", () => {
  /* The card used to BE the download link, with a `download` attribute the
     browser ignores cross-origin — so clicking it navigated to the raw PNG,
     and there was no way to reach a preview at all. */
  it("is a button that opens the preview, not a link to the file", async () => {
    const onOpen = vi.fn();
    render(<DesignCard generation={generation} onOpen={onOpen} />);

    expect(screen.queryByRole("link")).toBeNull();
    await userEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(generation);
  });

  it("names what it previews for assistive tech", () => {
    render(<DesignCard generation={generation} onOpen={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Preview Launch week" }),
    ).toBeInTheDocument();
  });

  it("falls back to the design type when there is no headline", () => {
    render(
      <DesignCard
        generation={{ ...(generation as object), headline: null } as never}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Preview Instagram post" }),
    ).toBeInTheDocument();
  });

  /* A variant that failed or is still rendering has no image to show. */
  it("renders nothing when the generation has no image", () => {
    const { container } = render(
      <DesignCard
        generation={{ ...(generation as object), url: null } as never}
        onOpen={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
