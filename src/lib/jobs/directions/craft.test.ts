import { describe, expect, it } from "vitest";
import {
  COPY_COLLIDES,
  COPY_STRADDLES_PANEL,
  CUTOUT_EDGE_SHOWS,
  cutoutEdgeShows,
  HEADLINE_NOT_LEADING,
  HEADLINE_UNDER_COPY,
  layoutCraftFaults,
  paletteForCutout,
} from "./craft";

const text = (
  id: string,
  role: string,
  fontSize: number,
  box: [number, number, number, number],
) => ({
  id,
  type: "text",
  role,
  fontSize,
  hidden: false,
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
});
const shape = (id: string, box: [number, number, number, number]) => ({
  id,
  type: "shape",
  hidden: false,
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
});
const faults = (elements: unknown[]) =>
  layoutCraftFaults({ elements } as never);

describe("layoutCraftFaults", () => {
  it("passes a headline that leads, copy apart, and copy inside its card", () => {
    expect(
      faults([
        shape("card", [80, 80, 920, 800]),
        text("headline", "headline", 72, [120, 120, 840, 180]),
        text("subheadline", "subheadline", 32, [120, 320, 840, 80]),
        shape("footer-bar", [0, 900, 1080, 180]),
        text("footer-1", "footer", 24, [80, 940, 920, 30]),
      ]),
    ).toEqual({ hard: null, soft: null });
  });

  /* The round-3 event quote card: headline 21 px, footer 28 px, the button
     across the card's edge and the footer bar. */
  it("finds every fault of the round-3 quote card", () => {
    const card = [
      shape("card", [86, 86, 908, 777]),
      text("headline", "headline", 21, [407, 720, 267, 30]),
      text("subheadline", "subheadline", 21, [337, 764, 407, 58]),
      {
        id: "cta",
        type: "button",
        fontSize: 21,
        hidden: false,
        x: 430,
        y: 853,
        width: 221,
        height: 55,
      },
      shape("footer-bar", [0, 906, 1080, 174]),
      text("footer-1", "footer", 28, [86, 932, 908, 38]),
    ];
    expect(faults(card).hard).toBe(HEADLINE_UNDER_COPY);
    const bigger = card.map((e) =>
      e.id === "headline" ? { ...e, fontSize: 30 } : e,
    );
    expect(faults(bigger)).toEqual({
      hard: COPY_STRADDLES_PANEL,
      soft: HEADLINE_NOT_LEADING,
    });
  });

  it("finds copy drawn over copy", () => {
    expect(
      faults([
        text("headline", "headline", 72, [100, 100, 800, 200]),
        text("subheadline", "subheadline", 32, [100, 250, 800, 80]),
      ]).hard,
    ).toBe(COPY_COLLIDES);
  });

  it("ignores a shared edge and the quote mark's hang", () => {
    expect(
      faults([
        text("quote-mark", "body", 160, [100, 60, 800, 90]),
        text("headline", "headline", 72, [100, 100, 800, 200]),
        text("subheadline", "subheadline", 32, [100, 301, 800, 80]),
      ]).hard,
    ).toBeNull();
  });
});

/* Round-3 live critic: the cut-out's pale matting rim "looks like torn
   paper on the dark card". */
describe("a cut-out's pale rim", () => {
  /* A 4x4 grid: a light opaque square in the middle, see-through around. */
  const rgba: number[] = [];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const inside = r > 0 && r < 3 && c > 0 && c < 3;
      rgba.push(240, 240, 235, inside ? 255 : 0);
    }
  }
  const facts = {
    width: 400,
    height: 400,
    cutout: true,
    ink: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
    grid: { cols: 4, rows: 4, rgba },
  };
  const image = {
    id: "image",
    type: "image",
    hidden: false,
    x: 200,
    y: 100,
    width: 600,
    height: 500,
  };
  const on = (fill: string) =>
    ({
      background: "#C2410C",
      elements: [{ ...shape("card", [80, 80, 920, 800]), fill }, image],
    }) as never;

  it("shows on a dark card, and is a soft fault", () => {
    expect(cutoutEdgeShows(on("#3B2416"), facts)).toBe(true);
    expect(layoutCraftFaults(on("#3B2416"), facts).soft).toBe(
      CUTOUT_EDGE_SHOWS,
    );
  });

  /* Round-5 live critic: the mille-feuille's pale matting was a hard white
     outline on the split layout's peach panel. */
  it("shows on a coloured light panel, and is a soft fault there too", () => {
    expect(cutoutEdgeShows(on("#F5D7C3"), facts)).toBe(true);
    expect(layoutCraftFaults(on("#F5D7C3"), facts).soft).toBe(
      CUTOUT_EDGE_SHOWS,
    );
  });

  it("does not show on a light card, or on a photograph", () => {
    expect(cutoutEdgeShows(on("#FFF4E6"), facts)).toBe(false);
    expect(cutoutEdgeShows(on("#FFFFFF"), facts)).toBe(false);
    expect(cutoutEdgeShows(on("#3B2416"), { ...facts, cutout: false })).toBe(
      false,
    );
  });
});

describe("paletteForCutout", () => {
  const rgba: number[] = [];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const inside = r > 0 && r < 3 && c > 0 && c < 3;
      rgba.push(240, 240, 235, inside ? 255 : 0);
    }
  }
  const pale = {
    width: 400,
    height: 400,
    cutout: true,
    ink: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
    grid: { cols: 4, rows: 4, rgba },
  };
  const spec = {
    palette: {
      background: "#3B2416",
      foreground: "#FFF4E6",
      accent: "#C2410C",
    },
  };

  /* Round-4 live run: every layout drew the pale-rimmed cut-out on the
     dark ground the model chose, so no layout could avoid it. */
  it("turns a dark ground light under a pale-rimmed cut-out", () => {
    expect(paletteForCutout(spec, pale).palette).toEqual({
      background: "#FFF4E6",
      foreground: "#3B2416",
      accent: "#C2410C",
    });
  });

  it("leaves a photograph, a light ground and a dark rim alone", () => {
    expect(paletteForCutout(spec, { ...pale, cutout: false })).toBe(spec);
    const light = {
      palette: {
        ...spec.palette,
        background: "#FFF4E6",
        foreground: "#3B2416",
      },
    };
    expect(paletteForCutout(light, pale)).toBe(light);
    const dark = {
      ...pale,
      grid: { ...pale.grid, rgba: rgba.map((v, i) => (i % 4 === 3 ? v : 30)) },
    };
    expect(paletteForCutout(spec, dark)).toBe(spec);
  });
});
