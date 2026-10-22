import type { Page } from "@playwright/test";

/**
 * Rendered text contrast, measured from pixels.
 *
 * A source scan reads what was written; this reads what the browser painted.
 * For every visible text run it takes two screenshots of the same frame, one
 * as rendered and one with every glyph made transparent. The second is the
 * text's real background: gradients, pseudo-element boxes, inset shadows, SVG
 * shapes, images and ancestor opacity are all already composited into it.
 *
 * The text colour comes from the computed style when nothing between the text
 * and the screen changes it (no opacity below 1, filter, blend mode or
 * background-clip text); the ratio is then exact, taken at the worst
 * background pixel under the glyphs. Otherwise it comes from the pixels too:
 * the strongest glyph pixel in each em-wide window, which at 2x is a fully
 * covered one, against the background at that pixel.
 */

export const DEVICE_SCALE = 2;
const GLYPH_DELTA = 10;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextRun {
  key: string;
  text: string;
  where: string;
  rects: Box[];
  required: number;
  /** The computed text colour, when it is what reaches the screen. */
  color: [number, number, number, number] | null;
}

export interface Measurement {
  key: string;
  text: string;
  where: string;
  ratio: number;
  required: number;
  method: "computed" | "pixels" | "invisible" | "unmeasured";
}

/* Runs in the page. Kept free of closures over module scope because
   Playwright serialises it as source. */
function collectRuns(scopeSelector: string | null): {
  runs: TextRun[];
  scroll: string;
} {
  const scope = scopeSelector
    ? document.querySelector(scopeSelector)
    : document.body;
  if (!scope) return { runs: [], scroll: "" };
  const viewport = { x: 0, y: 0, w: innerWidth, h: innerHeight };
  const DISABLED =
    'button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"]';
  const SKIP = "script, style, noscript, template, title, head";
  const EMOJI = /\p{Extended_Pictographic}|\u200d|\ufe0f/u;

  const intersect = (a: Box, b: Box): Box | null => {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w);
    const btm = Math.min(a.y + a.h, b.y + b.h);
    return r - x >= 1 && btm - y >= 1 ? { x, y, w: r - x, h: btm - y } : null;
  };
  const boxOf = (r: DOMRect): Box => ({
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
  });
  const parse = (c: string): [number, number, number, number] | null => {
    const m =
      /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+%?))?\)/.exec(c);
    if (!m) return null;
    const a =
      m[4] === undefined
        ? 1
        : m[4].endsWith("%")
          ? Number.parseFloat(m[4]) / 100
          : Number(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  };

  const REPLACED = new Set(["IMG", "VIDEO", "CANVAS", "IFRAME", "svg"]);
  const painted = (el: Element) => {
    if (REPLACED.has(el.tagName)) return true;
    const cs = getComputedStyle(el);
    const bg = parse(cs.backgroundColor);
    return (
      (bg !== null && bg[3] > 0) ||
      cs.backgroundImage !== "none" ||
      cs.backdropFilter !== "none"
    );
  };
  /** Something painted above the text at this point: a fixed header the page
   * scrolled under, a modal, a sibling laid over it. */
  const coveredAt = (el: Element, x: number, y: number) => {
    for (const hit of document.elementsFromPoint(x, y)) {
      if (hit === el || el.contains(hit) || hit.contains(el)) return false;
      if (painted(hit)) return true;
    }
    return false;
  };
  const hitTest = document.createElement("style");
  hitTest.textContent = "* { pointer-events: auto !important; }";
  document.head.append(hitTest);

  /** The part of a rect that every clipping ancestor lets through. */
  const visiblePart = (el: Element, rect: Box): Box | null => {
    let box: Box | null = intersect(rect, viewport);
    for (let e: Element | null = el; e && box; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        box = intersect(box, boxOf(e.getBoundingClientRect()));
      }
    }
    if (!box) return null;
    const midY = box.y + box.h / 2;
    const xs = [0.15, 0.5, 0.85].map((f) => box.x + box.w * f);
    return xs.every((x) => coveredAt(el, x, midY)) ? null : box;
  };

  const describe = (el: Element) => {
    const parts: string[] = [];
    for (
      let e: Element | null = el;
      e && parts.length < 4;
      e = e.parentElement
    ) {
      const tag = e.tagName.toLowerCase();
      const testCase = e.getAttribute("data-case");
      if (testCase) {
        parts.unshift(`[data-case=${testCase}]`);
        break;
      }
      const cls = (e.getAttribute("class") ?? "")
        .trim()
        .split(/\s+/)
        .slice(0, 3);
      parts.unshift(cls[0] ? `${tag}.${cls.join(".")}` : tag);
    }
    return parts.join(" > ");
  };

  const effectiveColor = (el: Element): TextRun["color"] => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (
        Number(cs.opacity) < 1 ||
        cs.filter !== "none" ||
        cs.mixBlendMode !== "normal" ||
        cs.backgroundClip === "text" ||
        cs.getPropertyValue("-webkit-background-clip") === "text"
      ) {
        return null;
      }
    }
    const cs = getComputedStyle(el);
    const svg = el instanceof SVGElement;
    const fill = svg
      ? parse(cs.fill)
      : parse(cs.webkitTextFillColor || cs.color);
    return fill;
  };

  const hidden = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || Number(cs.opacity) === 0) return true;
    }
    const cs = getComputedStyle(el);
    return cs.visibility !== "visible";
  };

  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (
      cs.backgroundClip === "text" ||
      cs.getPropertyValue("-webkit-background-clip") === "text"
    ) {
      el.setAttribute("data-cp-cliptext", "");
    }
  }

  const runs: TextRun[] = [];
  const add = (
    el: Element,
    text: string,
    rects: Box[],
    placeholder = false,
  ) => {
    const cs = getComputedStyle(el);
    const size = Number.parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const shown = placeholder ? getComputedStyle(el, "::placeholder") : null;
    const color =
      shown && Number(shown.opacity) < 1
        ? null
        : shown && effectiveColor(el)
          ? parse(shown.webkitTextFillColor || shown.color)
          : effectiveColor(el);
    const clipText = el.closest("[data-cp-cliptext]") !== null;
    if (color && color[3] === 0 && !clipText) return;
    let id = el.getAttribute("data-cp-id");
    if (!id) {
      const counter = window as unknown as { __cpNextId?: number };
      counter.__cpNextId = (counter.__cpNextId ?? 0) + 1;
      id = String(counter.__cpNextId);
      el.setAttribute("data-cp-id", id);
    }
    runs.push({
      key: `${id} ${text.slice(0, 60)}`,
      text: text.slice(0, 80),
      where: describe(el),
      rects,
      required: large ? 3 : 4.5,
      color: clipText ? null : color,
    });
  };

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    const value = node.textContent ?? "";
    if (!el || !value.trim()) continue;
    if (el.closest(SKIP) || el.closest(DISABLED) || hidden(el)) continue;
    const range = document.createRange();
    const rects: Box[] = [];
    let start = -1;
    const flush = (end: number) => {
      if (start < 0) return;
      range.setStart(node, start);
      range.setEnd(node, end);
      let found = [...range.getClientRects()].map(boxOf);
      if (found.length === 0 && el instanceof SVGElement) {
        found = [boxOf(el.getBoundingClientRect())];
      }
      for (const r of found) {
        if (r.w < 1.5 || r.h < 4) continue;
        const part = visiblePart(el, r);
        if (part) rects.push(part);
      }
      start = -1;
    };
    const chars = [...value];
    let offset = 0;
    for (const ch of chars) {
      if (EMOJI.test(ch) || /\s/.test(ch)) flush(offset);
      else if (start < 0) start = offset;
      offset += ch.length;
    }
    flush(offset);
    if (rects.length) add(el, value.trim(), rects);
  }

  const FIELDS =
    'input:not([type]), input[type="text"], input[type="email"], input[type="search"], input[type="url"], input[type="tel"], input[type="number"], input[type="submit"], input[type="button"], input[type="reset"], textarea, select';
  for (const field of scope.querySelectorAll(FIELDS)) {
    const value =
      field instanceof HTMLSelectElement
        ? (field.selectedOptions[0]?.text ?? "")
        : (field as HTMLInputElement).value;
    /* An empty field shows its placeholder, which is text the user reads
       (WCAG 1.4.3 makes no exception for it). */
    const placeholder =
      !value.trim() && !(field instanceof HTMLSelectElement)
        ? ((field as HTMLInputElement).placeholder ?? "")
        : "";
    const text = value.trim() || placeholder.trim();
    if (!text || field.matches(DISABLED) || hidden(field)) continue;
    const cs = getComputedStyle(field);
    const r = field.getBoundingClientRect();
    const padX =
      Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.borderLeftWidth);
    const padY =
      Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.borderTopWidth);
    const box = {
      x: r.left + padX,
      y: r.top + padY,
      w: r.width - 2 * padX,
      h: r.height - 2 * padY,
    };
    /* A textarea's box also holds its resize grip, which the text colour
       repaints; its first line is where the placeholder and value start. */
    if (field instanceof HTMLTextAreaElement) {
      const line =
        Number.parseFloat(cs.lineHeight) ||
        Number.parseFloat(cs.fontSize) * 1.4;
      box.h = Math.min(box.h, line);
    }
    const part = visiblePart(field, box);
    if (part) add(field, text, [part], text !== value.trim());
  }
  hitTest.remove();
  const scroll = [
    document.scrollingElement,
    ...document.querySelectorAll("body *"),
  ]
    .filter((e): e is Element => !!e && (e.scrollTop > 0 || e.scrollLeft > 0))
    .map((e) => `${e.scrollTop},${e.scrollLeft}`)
    .join("|");
  return { runs, scroll };
}

/* Scroll anchoring moved the document by tens of pixels while a run's
   geometry was read, so the boxes and the pixels disagreed. */
const FREEZE = `*, *::before, *::after {
  overflow-anchor: none !important;
  scroll-behavior: auto !important;
  transition: none !important;
  animation-play-state: paused !important;
  caret-color: transparent !important;
}`;

const HIDE_TEXT = `*, *::before, *::after, ::placeholder {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
  text-decoration-color: transparent !important;
}
svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }
[data-cp-cliptext] { background: none !important; }`;

async function setStyle(page: Page, id: string, css: string | null) {
  await page.evaluate(
    ([styleId, text]) => {
      document.getElementById(styleId)?.remove();
      if (text === null) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = text;
      document.head.append(style);
    },
    [id, css] as const,
  );
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

/* Runs in the analysis page: decodes both shots and measures every run. */
async function analyse(input: {
  shown: string;
  bare: string;
  runs: TextRun[];
  origin: { x: number; y: number };
  scale: number;
  glyphDelta: number;
}): Promise<Measurement[]> {
  const decode = async (b64: string) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const [shown, bare] = await Promise.all([
    decode(input.shown),
    decode(input.bare),
  ]);
  const { width, height } = shown;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (r: number, g: number, b: number) =>
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a: number, b: number) =>
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  /* A pixel belongs to the glyph when it sits on the line from the bare
     background towards the text colour. A focus ring or a currentColor
     border that also changed between the shots does not, so it is not
     mistaken for text and measured against itself. */
  const onGlyphLine = (
    shownPx: number[],
    barePx: number[],
    text: [number, number, number, number],
  ) => {
    const target = [0, 1, 2].map(
      (i) => text[i] * text[3] + barePx[i] * (1 - text[3]),
    );
    const span = [0, 1, 2].map((i) => target[i] - barePx[i]);
    const length = span.reduce((sum, d) => sum + d * d, 0);
    if (length < 1) return false;
    const t =
      [0, 1, 2].reduce(
        (sum, i) => sum + (shownPx[i] - barePx[i]) * span[i],
        0,
      ) / length;
    if (t < 0.25 || t > 1.15) return false;
    return [0, 1, 2].every(
      (i) => Math.abs(barePx[i] + span[i] * t - shownPx[i]) <= 24,
    );
  };

  return input.runs.map((run) => {
    let worstComputed = Number.POSITIVE_INFINITY;
    let worstWindow = Number.POSITIVE_INFINITY;
    let glyphs = 0;
    let changed = 0;
    let firstBare: number[] | null = null;
    for (const rect of run.rects) {
      /* One CSS pixel in from the run's box: glyphs never reach its edge, and
         rounding there picks up whatever is drawn just outside it. */
      const inset = rect.w > 4 && rect.h > 6 ? 1 : 0;
      const toDevice = (v: number, o: number) =>
        Math.round((v - o) * input.scale);
      const x0 = Math.max(0, toDevice(rect.x + inset, input.origin.x));
      const y0 = Math.max(0, toDevice(rect.y + inset, input.origin.y));
      const x1 = Math.min(
        width,
        toDevice(rect.x + rect.w - inset, input.origin.x),
      );
      const y1 = Math.min(
        height,
        toDevice(rect.y + rect.h - inset, input.origin.y),
      );
      const windowWidth = Math.max(4, Math.round((y1 - y0) * 0.6));
      for (let wx = x0; wx < x1; wx += windowWidth) {
        let best = 0;
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = wx; x < Math.min(x1, wx + windowWidth); x++) {
            const i = (y * width + x) * 4;
            const shownPx = [
              shown.data[i],
              shown.data[i + 1],
              shown.data[i + 2],
            ];
            const barePx = [bare.data[i], bare.data[i + 1], bare.data[i + 2]];
            firstBare ??= barePx;
            const delta = Math.max(
              ...[0, 1, 2].map((c) => Math.abs(shownPx[c] - barePx[c])),
            );
            if (delta < input.glyphDelta) continue;
            const ground = lum(barePx[0], barePx[1], barePx[2]);
            count++;
            changed++;
            best = Math.max(
              best,
              ratio(lum(shownPx[0], shownPx[1], shownPx[2]), ground),
            );
            if (run.color && onGlyphLine(shownPx, barePx, run.color)) {
              glyphs++;
              const [r, g, b, a] = run.color;
              const text = lum(
                r * a + barePx[0] * (1 - a),
                g * a + barePx[1] * (1 - a),
                b * a + barePx[2] * (1 - a),
              );
              worstComputed = Math.min(worstComputed, ratio(text, ground));
            }
          }
        }
        if (count >= 3) worstWindow = Math.min(worstWindow, best);
      }
    }
    const base = {
      key: run.key,
      text: run.text,
      where: run.where,
      required: run.required,
    };
    /* None of the run's box landed in the shot: its geometry went stale. That
       fails, under its own name, rather than passing unmeasured. */
    if (!firstBare) return { ...base, ratio: 0, method: "unmeasured" as const };
    if (changed === 0) {
      /* Nothing changed when the text was hidden: it is painted in the
         colour of its own background. */
      if (run.color) {
        const [r, g, b, a] = run.color;
        const ground = lum(firstBare[0], firstBare[1], firstBare[2]);
        const text = lum(
          r * a + firstBare[0] * (1 - a),
          g * a + firstBare[1] * (1 - a),
          b * a + firstBare[2] * (1 - a),
        );
        return {
          ...base,
          ratio: ratio(text, ground),
          method: "computed" as const,
        };
      }
      return { ...base, ratio: 1, method: "invisible" as const };
    }
    /* With no pixel on the line to the computed colour, something the style
       walk did not see recoloured the text; trust the pixels instead. */
    if (run.color && glyphs > 0) {
      return { ...base, ratio: worstComputed, method: "computed" as const };
    }
    return {
      ...base,
      ratio: Number.isFinite(worstWindow) ? worstWindow : 1,
      method: "pixels" as const,
    };
  });
}

export interface ProbeOptions {
  /** Measure only text inside this element. */
  scope?: string;
  /** Screenshot only the scope element, grown by this many CSS px. */
  pad?: number;
}

/* Every scroll offset on the page. Geometry is read in one evaluate and the
   pixels in two screenshots after it, so a scroll in between (a smooth scroll
   still running, scroll anchoring) would measure the wrong pixels. */
const scrollState = (page: Page) =>
  page.evaluate(() =>
    [document.scrollingElement, ...document.querySelectorAll("body *")]
      .filter(
        (el): el is Element => !!el && (el.scrollTop > 0 || el.scrollLeft > 0),
      )
      .map((el) => `${el.scrollTop},${el.scrollLeft}`)
      .join("|"),
  );

async function scopeClip(page: Page, scope: string, pad: number) {
  return page.evaluate(
    ([selector, grow]) => {
      const el = document.querySelector(selector as string);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, r.left - (grow as number));
      const y = Math.max(0, r.top - (grow as number));
      const w = Math.min(innerWidth, r.right + (grow as number)) - x;
      const h = Math.min(innerHeight, r.bottom + (grow as number)) - y;
      return w >= 2 && h >= 2 ? { x, y, w, h } : null;
    },
    [scope, pad] as const,
  );
}

/** Measures every visible text run in the current viewport. */
export async function probeViewport(
  page: Page,
  analysisPage: Page,
  options: ProbeOptions = {},
): Promise<Measurement[]> {
  await setStyle(page, "__cp_freeze", FREEZE);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await scrollState(page);
      const { runs, scroll } = await page.evaluate(
        collectRuns,
        options.scope ?? null,
      );
      if (runs.length === 0) return [];
      const clip =
        options.scope && options.pad !== undefined
          ? await scopeClip(page, options.scope, options.pad)
          : null;
      if (options.pad !== undefined && !clip) return [];
      const shot = async () =>
        (
          await page.screenshot({
            scale: "device",
            animations: "allow",
            caret: "initial",
            ...(clip
              ? {
                  clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h },
                }
              : {}),
          })
        ).toString("base64");
      const shown = await shot();
      await setStyle(page, "__cp_hide", HIDE_TEXT);
      const bare = await shot();
      await setStyle(page, "__cp_hide", null);
      const after = await scrollState(page);
      if (scroll !== before || after !== before) {
        await page.waitForTimeout(200);
        continue;
      }
      return analysisPage.evaluate(analyse, {
        shown,
        bare,
        runs,
        origin: clip ? { x: clip.x, y: clip.y } : { x: 0, y: 0 },
        scale: DEVICE_SCALE,
        glyphDelta: GLYPH_DELTA,
      });
    }
    throw new Error("the page kept scrolling while it was being measured");
  } finally {
    await setStyle(page, "__cp_freeze", null);
  }
}

/** The element that scrolls the page: the document, or the app shell's main
 * pane when the document itself does not scroll. */
async function scrollTargets(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const doc = document.scrollingElement as HTMLElement;
    const candidates = [
      doc,
      ...document.querySelectorAll<HTMLElement>("body *"),
    ]
      .filter((el) => {
        if (el.scrollHeight <= el.clientHeight + 8) return false;
        if (el === doc) return true;
        const overflow = getComputedStyle(el).overflowY;
        return overflow === "auto" || overflow === "scroll";
      })
      .sort(
        (a, b) =>
          b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth,
      );
    const target = candidates[0];
    if (!target) return [0];
    target.setAttribute("data-cp-scroller", "");
    const step = Math.max(200, Math.floor(target.clientHeight * 0.6));
    const positions: number[] = [];
    for (
      let y = 0;
      y < target.scrollHeight - target.clientHeight + step;
      y += step
    ) {
      positions.push(Math.min(y, target.scrollHeight - target.clientHeight));
    }
    return [...new Set(positions)];
  });
}

/** Measures every text run on the page at rest, scrolling the main scroller
 * through its whole height. A run seen at several positions keeps its worst. */
export async function probePage(page: Page, analysisPage: Page) {
  const worst = new Map<string, Measurement>();
  for (const y of await scrollTargets(page)) {
    await page.evaluate((top) => {
      const target =
        document.querySelector<HTMLElement>("[data-cp-scroller]") ??
        (document.scrollingElement as HTMLElement);
      target.scrollTop = top;
    }, y);
    await page.waitForTimeout(150);
    for (const m of await probeViewport(page, analysisPage)) {
      const seen = worst.get(m.key);
      if (!seen || m.ratio < seen.ratio) worst.set(m.key, m);
    }
  }
  return [...worst.values()];
}

const INTERACTIVE =
  'a[href], button, summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="link"], input[type="submit"], input[type="button"], [tabindex="0"]';

export type InteractiveState = "hover" | "focus" | "active";

export interface StateMeasurement extends Measurement {
  state: InteractiveState;
}

/** Hover, keyboard focus and press on every visible, enabled control that
 * carries text, measuring the control's own text in each state. */
export interface InteractiveProbe {
  measurements: StateMeasurement[];
  /** Controls whose states could not be measured, with the reason. */
  skipped: string[];
}

/** Marks the controls to visit, in document order, and returns their count. */
function markControls(page: Page, limit: number) {
  return page.evaluate(
    ([selector, max]) => {
      const found = [...document.querySelectorAll(selector as string)].filter(
        (el) => {
          if (el.closest('button:disabled, [aria-disabled="true"]'))
            return false;
          const r = el.getBoundingClientRect();
          return (
            r.width > 4 &&
            r.height > 4 &&
            (el.textContent ?? "").trim() !== "" &&
            getComputedStyle(el).visibility === "visible"
          );
        },
      );
      for (const [i, el] of found.slice(0, max as number).entries()) {
        el.setAttribute("data-cp-control", String(i));
      }
      return Math.min(found.length, max as number);
    },
    [INTERACTIVE, limit] as const,
  );
}

/** Hover, keyboard focus and press on every visible, enabled control that
 * carries text, measuring the control's own text in each state. */
export async function probeInteractive(
  page: Page,
  analysisPage: Page,
  limit = 120,
): Promise<InteractiveProbe> {
  const startUrl = page.url();
  let count = await markControls(page, limit);
  const measurements: StateMeasurement[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < count; i++) {
    const selector = `[data-cp-control="${i}"]`;
    const control = page.locator(selector);
    if ((await control.count()) === 0) {
      skipped.push(`control ${i}: gone from the page`);
      continue;
    }
    try {
      await control.scrollIntoViewIfNeeded({ timeout: 2000 });
      const box = await control.boundingBox();
      if (!box) {
        skipped.push(`control ${i}: no box`);
        continue;
      }
      const measure = async (state: InteractiveState) => {
        for (const m of await probeViewport(page, analysisPage, {
          scope: selector,
          pad: 4,
        })) {
          measurements.push({ ...m, state });
        }
      };
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await measure("hover");
      await page.mouse.down();
      await measure("active");
      /* Releasing away from the control cancels the click, so pressing a
         link or a submit button does not leave the page. */
      await page.mouse.move(1, 1);
      await page.mouse.up();
      await page.keyboard.press("Escape");
      await page.evaluate((sel) => {
        (document.activeElement as HTMLElement | null)?.blur();
        document
          .querySelector<HTMLElement>(sel)
          ?.focus({ focusVisible: true } as FocusOptions);
      }, selector);
      await measure("focus");
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
    } catch (error) {
      skipped.push(
        `control ${i}: ${String(error).split("\n")[0].slice(0, 160)}`,
      );
    }
    if (page.url() !== startUrl) {
      skipped.push(`control ${i}: navigated to ${page.url()}`);
      await page.goto(startUrl, { waitUntil: "networkidle" });
      count = await markControls(page, limit);
    }
  }
  return { measurements, skipped };
}

export function failures<T extends Measurement>(measurements: T[]): T[] {
  return measurements.filter((m) => m.ratio < m.required);
}
