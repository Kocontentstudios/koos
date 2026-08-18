import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above const declarations, so the spy has to be too.
const { identifyUser } = vi.hoisted(() => ({ identifyUser: vi.fn() }));
vi.mock("@/lib/analytics/posthog-client", () => ({ identifyUser }));

import { PostHogIdentify } from "./posthog-identify";

describe("PostHogIdentify", () => {
  it("identifies with the DB user id on mount", () => {
    render(<PostHogIdentify userId="user-1" />);
    expect(identifyUser).toHaveBeenCalledWith("user-1");
  });

  it("renders nothing into the layout", () => {
    const { container } = render(<PostHogIdentify userId="user-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not re-identify on re-render with the same user", () => {
    identifyUser.mockClear();
    const { rerender } = render(<PostHogIdentify userId="user-1" />);
    rerender(<PostHogIdentify userId="user-1" />);
    expect(identifyUser).toHaveBeenCalledTimes(1);
  });

  /* A workspace switch or account change must re-point the browser. */
  it("identifies again when the user changes", () => {
    identifyUser.mockClear();
    const { rerender } = render(<PostHogIdentify userId="user-1" />);
    rerender(<PostHogIdentify userId="user-2" />);
    expect(identifyUser).toHaveBeenLastCalledWith("user-2");
  });
});
