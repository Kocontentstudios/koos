import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { ButtonControl } from "./button-control";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Start Creating</Button>);
    expect(
      screen.getByRole("button", { name: "Start Creating" }),
    ).toBeInTheDocument();
  });
  /* White on the brand --primary is 3.78:1; the fill tokens hold 5.08, 5.85
     and 6.95 at rest, hover and pressed (theme-contrast.test.ts). */
  it("paints the default variant on the primary fill tokens, not --primary", () => {
    render(<Button>Go</Button>);
    const cls = screen.getByRole("button", { name: "Go" }).className;
    expect(cls).toMatch(/(?:^|\s)bg-primary-fill(?:\s|$)/);
    expect(cls).toContain("hover:bg-primary-fill-hover");
    expect(cls).toContain("active:bg-primary-fill-active");
    expect(cls).toContain("text-primary-foreground");
    expect(cls).not.toMatch(/(?:^|[\s:])bg-primary(?:\s|$)/);
  });
  it("renders a secondary (outline) variant with a border", () => {
    render(<Button variant="secondary">Cancel</Button>);
    const cls = screen.getByRole("button", { name: "Cancel" }).className;
    expect(cls).toMatch(/border/);
    expect(cls).not.toMatch(/bg-primary\b/);
  });
  it("renders a ghost variant with a transparent background", () => {
    render(<Button variant="ghost">More</Button>);
    expect(screen.getByRole("button", { name: "More" }).className).not.toMatch(
      /bg-primary\b/,
    );
  });

  /* The ring was --accent-glow, a 12% tint that measured 1.15:1 in light mode:
     keyboard focus on every Button was invisible. The token's contrast is held
     by src/app/theme-contrast.test.ts; this pins that every variant uses it. */
  it.each([
    "default",
    "secondary",
    "ghost",
    "icon",
    "outline",
    "destructive",
    "link",
  ] as const)("draws the --ring focus outline on the %s variant", (variant) => {
    render(<Button variant={variant}>Focus me</Button>);
    const cls = screen.getByRole("button", { name: "Focus me" }).className;
    expect(cls).toContain("focus-visible:focus-outline");
    expect(cls).not.toMatch(/focus-visible:ring-/);
  });
});

/**
 * `loading` is the app's pending-state contract — a dozen call-site tests
 * assert against the behaviour defined here, but the primitive itself had no
 * coverage, so the contract they depend on was unpinned.
 */
describe("Button loading state", () => {
  it("swaps the label for loadingText and shows a spinner", () => {
    const { container } = render(
      <Button loading loadingText="Saving…">
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("keeps the original label when no loadingText is given", () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  /* Loading is not disabled (CLAUDE.md "Every wait gets an affordance"): the
     disabled fill under a "Saving…" label measured 1.87:1 dark, 2.04:1 light.
     The label stays on the fill it is measured against and the click is
     swallowed instead. */
  it("marks itself busy and swallows the click, without disabling", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading loadingText="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the resting fill and full opacity while loading", () => {
    render(<Button loading>Save</Button>);
    const cls = screen.getByRole("button", { name: "Save" }).className;
    expect(cls).toMatch(/(?:^|\s)bg-primary-fill(?:\s|$)/);
    expect(cls).not.toMatch(/(?:^|\s)(?:data-loading:|aria-busy:)?opacity-/);
  });

  it("does not submit its form while loading, by click or by Enter", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Name" />
        <Button type="submit" loading loadingText="Saving…">
          Save
        </Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Saving…" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "a{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not bubble the swallowed click to a clickable parent", async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a clickable row is the case under test
      // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is covered by the form test above
      <div onClick={onRowClick}>
        <Button loading>Save</Button>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("stays busy-free and enabled when idle", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("respects an explicit disabled alongside loading", () => {
    render(
      <Button disabled loading>
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  /* The default variant has its own disabled tokens (3.65:1 dark, 5.81:1
     light). The 50% opacity the other variants use would halve that under the
     label, so the spec's 3:1 floor would only hold before it. */
  it("paints a disabled primary on its disabled tokens, at full opacity", () => {
    render(<Button disabled>Save</Button>);
    const cls = screen.getByRole("button", { name: "Save" }).className;
    expect(cls).toContain("disabled:bg-primary-disabled");
    expect(cls).toContain("disabled:text-primary-disabled-foreground");
    expect(cls).not.toMatch(/disabled:opacity-/);
  });

  it.each(["secondary", "ghost", "outline"] as const)(
    "still fades a disabled %s button",
    (variant) => {
      render(
        <Button variant={variant} disabled>
          Save
        </Button>,
      );
      expect(screen.getByRole("button", { name: "Save" }).className).toContain(
        "disabled:opacity-50",
      );
    },
  );
});

/**
 * Server Components render Button (brand/page.tsx, calendar/page.tsx), so
 * Button runs as a plain function on the server and everything it returns is
 * serialised to the client. jsdom never serialises, which is how round 3's
 * click guard crashed /brand with this suite green. Calling Button the way the
 * server does and walking its output pins that it creates no function.
 */
describe("Button rendered from a Server Component", () => {
  const functionsIn = (node: unknown, at = "Button"): string[] => {
    if (typeof node === "function") return [at];
    if (Array.isArray(node)) {
      return node.flatMap((child, i) => functionsIn(child, `${at}[${i}]`));
    }
    if (!isValidElement(node)) return [];
    const name =
      typeof node.type === "string"
        ? node.type
        : ((node.type as { name?: string }).name ?? "?");
    return Object.entries(node.props as Record<string, unknown>).flatMap(
      ([key, value]) => functionsIn(value, `${at} > ${name}.${key}`),
    );
  };

  it.each([
    ["idle", {}],
    ["loading", { loading: true, loadingText: "Saving…" }],
    ["disabled", { disabled: true }],
    ["a link render", { render: <a href="/brand">Brand</a> }],
  ] as const)("returns no function when %s", (_, props) => {
    for (const variant of [
      "default",
      "secondary",
      "ghost",
      "icon",
      "outline",
      "destructive",
      "link",
    ] as const) {
      expect(
        functionsIn(Button({ variant, children: "Save", ...props })),
      ).toEqual([]);
    }
  });

  it("hands the loading flag to the client control, which owns the guard", () => {
    const element = Button({ loading: true, children: "Save" });
    expect(element.type).toBe(ButtonControl);
    expect(element.props).toMatchObject({ loading: true, "aria-busy": true });
  });
});
