import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const OPTIONS = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
];

describe("SegmentedControl", () => {
  it("marks the active option with aria-pressed", () => {
    render(
      <SegmentedControl options={OPTIONS} value="week" onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("calls onChange with the clicked value", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={OPTIONS} value="week" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});

/* KOS-V1-BUG-012.
   What jsdom CAN prove is below: which tokens the component asks for, that no
   literal colour is baked in, and that the selected state carries a cue which
   is not colour. What it CANNOT prove is that any of it is visible. jsdom
   loads no stylesheet, resolves no custom property and composites no alpha,
   which is exactly why a 4%-white track and a white-on-white chip passed every
   test for months. The ratios are therefore computed from globals.css at the
   bottom of this file rather than asserted as token names alone. */

const renderControl = (value = "week") =>
  render(
    <SegmentedControl options={OPTIONS} value={value} onChange={() => {}} />,
  );

const track = (container: HTMLElement) =>
  container.querySelector("div") as HTMLElement;

const segment = (label: string) => screen.getByRole("button", { name: label });

/** class + style of every node the component renders, the track included. */
const paintedStrings = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("*"))
    .flatMap((el) => [el.getAttribute("class"), el.getAttribute("style")])
    .filter((s): s is string => Boolean(s));

describe("colour regressions", () => {
  /* The literal that caused the bug: a 4%-white wash is a dark-theme device,
     and on a white light-mode surface it composites to 1.01:1. */
  it("bakes in no literal colour of any kind", () => {
    const { container } = renderControl();
    for (const painted of paintedStrings(container)) {
      expect(painted).not.toMatch(/rgba?\(/);
      expect(painted).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(painted).not.toMatch(
        /\b(?:bg|text|border|outline)-(?:white|black)\b/,
      );
    }
  });

  /* --surface-1 and --surface-2 are BOTH #ffffff in light mode, so a surface
     token is not a fill here, it is an invisible chip on a white card. */
  it("draws the selected segment with no surface token", () => {
    const { container } = renderControl();
    for (const painted of paintedStrings(container)) {
      expect(painted).not.toMatch(/surface-[12]/);
    }
    expect(segment("Week").className).toContain("bg-foreground");
    expect(segment("Week").className).toContain("text-background");
  });

  it("leaves the track's fill to the host surface rather than washing it", () => {
    const { container } = renderControl();
    expect(track(container).className).not.toMatch(/\bbg-/);
  });
});

describe("grouping", () => {
  /* The edge is what makes several buttons read as one control. It is set
     inline because globals.css's unlayered `* { border-color: var(--border) }`
     beats any `border-[…]` utility, so asserting a class would prove nothing. */
  it("draws the track edge inline, in the control-boundary token", () => {
    const { container } = renderControl();
    expect(track(container).className).toMatch(/\bborder\b/);
    expect(track(container).style.borderColor).toBe("var(--border-control)");
  });

  it.each([
    ["--border", "a surface edge: 1.09-1.23:1"],
    ["--border-accent", "1.58-1.79:1"],
    ["--border-hover", "1.26-1.48:1"],
  ])("does not draw the track edge in %s (%s)", (token) => {
    const { container } = renderControl();
    expect(track(container).style.borderColor).not.toBe(`var(${token})`);
  });
});

describe("selection is not signalled by colour alone", () => {
  /* Excluding `before:` because the width reservation is permanently bold in
     both states — matching it here would report every segment as selected. */
  const appliedClasses = (label: string) =>
    segment(label)
      .className.split(/\s+/)
      .filter((c) => !c.startsWith("before:"));

  it("gives the selected segment a weight the others do not have", () => {
    renderControl();
    expect(appliedClasses("Week")).toContain("font-bold");
    expect(appliedClasses("Month")).toContain("font-medium");
    expect(appliedClasses("Month")).not.toContain("font-bold");
  });

  /* Weight is only usable as a cue if selecting a segment cannot reflow the
     row. A permanently-bold ::before copy holds the wider measurement in both
     states, so the track's width never depends on which segment is selected. */
  it("reserves the bold width in every state", () => {
    renderControl("week");
    for (const label of ["Week", "Month"]) {
      const cls = segment(label).className;
      expect(cls).toContain("before:content-[attr(data-label)]");
      expect(cls).toContain("before:font-bold");
      expect(cls).toContain("before:invisible");
      expect(segment(label).getAttribute("data-label")).toBe(label);
    }
  });

  /* The width reservation must not become text. A duplicated label node would
     make textContent read "WeekWeek" and break getByText for every consumer;
     generated content stays out of both textContent and the accessible name. */
  it("keeps each button's text to a single copy of the label", () => {
    renderControl();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Month",
      "Week",
    ]);
    expect(screen.getByText("Week")).toBeInTheDocument();
  });
});

describe("focus indicator", () => {
  /* The component had none and fell back to the UA default, which the
     consumer's overflow-x-auto clips. */
  it("rings the focused segment in a token that clears 3:1 on every ground", () => {
    renderControl();
    const cls = segment("Month").className;
    expect(cls).toContain("focus-visible:outline-[var(--primary)]");
    expect(cls).toContain("focus-visible:outline-2");
  });

  /* Inset, and that is functional rather than cosmetic: the calendar consumer
     wraps this control in `overflow-x-auto`, which clips an outward ring on the
     first and last segment. Changing the offset re-opens both the clipping
     question and the measurement: an outward ring is measured against the host
     ground, an inset one against the segment it sits on. */
  it("draws the ring inside the segment so a scrolling track cannot clip it", () => {
    renderControl();
    expect(segment("Month").className).toContain(
      "focus-visible:-outline-offset-2",
    );
  });
});

describe("the calendar consumer", () => {
  it("merges the consumer's className onto the track", () => {
    const { container } = render(
      <SegmentedControl
        options={OPTIONS}
        value="week"
        onChange={() => {}}
        className="overflow-x-auto"
      />,
    );
    expect(track(container).className).toContain("overflow-x-auto");
    expect(track(container).style.borderColor).toBe("var(--border-control)");
  });
});

/**
 * The token identities above are worthless if the tokens themselves drift, so
 * the ratios are computed from globals.css rather than trusted. This block is
 * what makes "3:1" a fact instead of a comment: it fails the day someone
 * lightens --border-control or repoints --foreground.
 */

type Rgb = [number, number, number];

function parseColor(value: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const h =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
      1,
    ];
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (!rgba) throw new Error(`unparseable colour: ${value}`);
  const parts = rgba[1].split(",").map((p) => Number(p.trim()));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

/* An alpha token is never seen on its own — only over the surface behind it. */
function over(value: string, background: Rgb): Rgb {
  const [r, g, b, a] = parseColor(value);
  if (a === 1) return [r, g, b];
  return [
    Math.round(a * r + (1 - a) * background[0]),
    Math.round(a * g + (1 - a) * background[1]),
    Math.round(a * b + (1 - a) * background[2]),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function tokenBlock(css: string, selector: string): Record<string, string> {
  const open = css.indexOf("{", css.indexOf(selector));
  let depth = 0;
  let close = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}" && --depth === 0) {
      close = i;
      break;
    }
  }
  const out: Record<string, string> = {};
  for (const [, name, value] of css
    .slice(open, close)
    .matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[name] = value.trim();
  }
  return out;
}

/* Comments carry colons and prose the declaration regex would read as tokens. */
const CSS = readFileSync(
  path.join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const DARK = tokenBlock(CSS, ":root {");
const LIGHT = { ...DARK, ...tokenBlock(CSS, ':root[data-theme="light"]') };

describe.each([
  { theme: "dark", t: DARK },
  { theme: "light", t: LIGHT },
])("token contrast in $theme mode", ({ t }) => {
  /* Both grounds the control can land on: the calendar toolbar sits on the
     page, and the component is generic enough to be dropped on a card. The
     track has no fill of its own, so the ground IS the track. */
  describe.each([
    { where: "the page", groundToken: "--background" },
    { where: "a card", groundToken: "--surface-1" },
  ])("on $where", ({ groundToken }) => {
    const ground = parseColor(t[groundToken]).slice(0, 3) as Rgb;
    const chip = over(t["--foreground"], ground);

    it("draws a track edge at 3:1 or better (WCAG 1.4.11)", () => {
      expect(
        ratio(over(t["--border-control"], ground), ground),
      ).toBeGreaterThanOrEqual(3);
    });

    it("marks the selected segment with a boundary at 3:1 or better", () => {
      expect(ratio(chip, ground)).toBeGreaterThanOrEqual(3);
    });

    it("keeps the focus ring visible wherever it lands", () => {
      expect(
        ratio(over(t["--primary"], ground), ground),
      ).toBeGreaterThanOrEqual(3);
      expect(ratio(over(t["--primary"], chip), chip)).toBeGreaterThanOrEqual(3);
    });

    it("keeps the 13px labels at 4.5:1 or better (WCAG 1.4.3)", () => {
      expect(ratio(over(t["--background"], chip), chip)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        ratio(over(t["--text-secondary"], ground), ground),
      ).toBeGreaterThanOrEqual(4.5);
    });

    /* The defect as a number, and a trip-wire: if --surface-2 or the white
       wash ever stops computing to ~1:1 here, the reason this component was
       rewritten no longer holds and the design should be re-read, not
       inherited. */
    it("keeps the shipped values that caused the bug measurably invisible", () => {
      const oldTrack = over("rgba(255, 255, 255, 0.04)", ground);
      expect(ratio(oldTrack, ground)).toBeLessThan(1.2);
      expect(ratio(over(t["--surface-2"], oldTrack), oldTrack)).toBeLessThan(
        1.2,
      );
    });
  });
});
