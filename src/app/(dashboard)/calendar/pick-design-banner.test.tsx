import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PickDesignBanner } from "./pick-design-banner";

const PICK = /Pick a content item to request a design for/;
const OPEN_DAY = /Open a day to pick one of its posts/;
const NOTHING = /Nothing here to request a design for/;

describe("PickDesignBanner", () => {
  it("tells the user what to do when items are clickable", () => {
    render(<PickDesignBanner guidance="pick" />);
    expect(screen.getByText(PICK)).toBeInTheDocument();
    expect(screen.getByText("Send to design team")).toBeInTheDocument();
  });

  /* Month view renders items inside pointer-events-none containers, so "pick
     an item" would be an instruction the user physically cannot follow. */
  it("asks month users to open a day instead of clicking an item", () => {
    render(<PickDesignBanner guidance="openDay" />);
    expect(screen.getByText(OPEN_DAY)).toBeInTheDocument();
    expect(screen.queryByText(PICK)).not.toBeInTheDocument();
  });

  it("offers a way out instead of pointing at an empty list", () => {
    render(<PickDesignBanner guidance="none" />);
    expect(screen.queryByText(PICK)).not.toBeInTheDocument();
    expect(screen.queryByText(OPEN_DAY)).not.toBeInTheDocument();
    expect(screen.getByText(NOTHING)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /describe the design yourself/ }),
    ).toHaveAttribute("href", "/design-request/new");
  });

  /* Agenda hides the prev/Today/next arrows and the calendar switcher only
     renders with more than one calendar, so the escape copy may only point at
     the view toggle, which every view shows. Asserted positively: banning one
     retired phrase would let the next wording through. */
  it("names the one control every view renders, and a single way out", () => {
    render(<PickDesignBanner guidance="none" />);
    expect(screen.getByText(NOTHING).textContent).toMatch(/another view/i);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("can be dismissed", async () => {
    const user = userEvent.setup();
    render(<PickDesignBanner guidance="pick" />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(PICK)).not.toBeInTheDocument();
  });
});
