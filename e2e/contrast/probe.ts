import { appendFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";

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
  /** Something translucent is painted over the text. The pixels are measured
   * through it; if no glyph shows through at all, it covers the text. */
  veiled: boolean;
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
function collectRuns(args: {
  scope: string | null;
  only: string | null;
  selectionSelectors: string[] | null;
}): {
  runs: TextRun[];
  scroll: string;
} {
  const { only } = args;
  const scope = args.scope ? document.querySelector(args.scope) : document.body;
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
  /* Chrome serialises a colour in the space it was written in, so a
     Tailwind v4 palette colour computes to oklch() or oklab(), not rgb().
     Anything that is not rgb() is painted on a 1px canvas and read back. */
  const swatch = new OffscreenCanvas(1, 1).getContext("2d", {
    willReadFrequently: true,
  }) as OffscreenCanvasRenderingContext2D;
  const viaCanvas = (c: string): [number, number, number, number] | null => {
    if (!c || c === "none") return null;
    swatch.clearRect(0, 0, 1, 1);
    swatch.fillStyle = "#000";
    swatch.fillStyle = c;
    swatch.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const parse = (c: string): [number, number, number, number] | null => {
    const m =
      /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+%?))?\)/.exec(c);
    if (!m)
      return /^(?:oklch|oklab|lab|lch|color|hsl|hwb)\(/.test(c)
        ? viaCanvas(c)
        : null;
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
   * scrolled under, a modal, a sibling laid over it. A solid cover hides the
   * text; a translucent one (a scrim, a faded overlay) is read through, so the
   * text is still measured, from the pixels. */
  const opaque = (el: Element) => {
    if (REPLACED.has(el.tagName)) return true;
    const cs = getComputedStyle(el);
    const bg = parse(cs.backgroundColor);
    return (
      bg !== null &&
      bg[3] >= 0.99 &&
      Number(cs.opacity) >= 0.99 &&
      cs.mixBlendMode === "normal"
    );
  };
  const pinnedBar = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const position = getComputedStyle(e).position;
      if (position !== "fixed" && position !== "sticky") continue;
      const r = e.getBoundingClientRect();
      return r.width * r.height < 0.5 * innerWidth * innerHeight;
    }
    return false;
  };
  const coveredAt = (
    el: Element,
    x: number,
    y: number,
  ): { kind: "opaque"; by: Element } | { kind: "veil" } | null => {
    let veil = false;
    for (const hit of document.elementsFromPoint(x, y)) {
      if (hit === el || el.contains(hit) || hit.contains(el)) break;
      if (!painted(hit)) continue;
      if (opaque(hit)) return { kind: "opaque", by: hit };
      /* Frosted glass (a header with backdrop-filter) blurs what is under it
         on purpose: the page scrolls text under it, and that text is read at
         another scroll position. It is left out like an opaque cover. A plain
         translucent layer (a scrim, a decorative glow) is measured through. */
      if (getComputedStyle(hit).backdropFilter !== "none") {
        return { kind: "opaque", by: hit };
      }
      /* The same for a translucent bar fixed to the viewport (a phone's
         header or tab bar): text passes under it as the page scrolls. A
         fixed layer over most of the viewport (a glow, a scrim) is not a
         bar, and is measured through. */
      if (pinnedBar(hit)) return { kind: "opaque", by: hit };
      veil = true;
    }
    return veil ? { kind: "veil" } : null;
  };
  /* A bar fixed to the viewport (the landing nav) casts its shadow on
     whatever the page scrolls under it. Text in that shadow at one scroll
     position is read at another, so the shadow's reach around the bar is
     left out, like the bar itself. A fixed element without a shadow leaves
     nothing out. */
  const pinnedShadows: { owner: Element; shadow: Box }[] = [];
  for (const candidate of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(candidate);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.boxShadow === "none" || cs.visibility !== "visible") continue;
    let reach = 0;
    for (const layer of cs.boxShadow.split(/,(?![^(]*\))/)) {
      if (layer.includes("inset")) continue;
      const lengths = (
        layer.replace(/rgba?\([^)]*\)/g, "").match(/-?[\d.]+px/g) ?? []
      ).map((v) => Math.abs(Number.parseFloat(v)));
      const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
      reach = Math.max(reach, Math.max(x, y) + blur + spread);
    }
    if (reach === 0) continue;
    const r = candidate.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    pinnedShadows.push({
      owner: candidate,
      shadow: {
        x: r.left - reach,
        y: r.top - reach,
        w: r.width + 2 * reach,
        h: r.height + 2 * reach,
      },
    });
  }

  /** A box with another taken out of it: what is left, in up to four parts. */
  const subtract = (a: Box, b: Box): Box[] => {
    const cut = intersect(a, b);
    if (!cut) return [a];
    const parts: Box[] = [
      { x: a.x, y: a.y, w: a.w, h: cut.y - a.y },
      { x: a.x, y: cut.y + cut.h, w: a.w, h: a.y + a.h - (cut.y + cut.h) },
      { x: a.x, y: cut.y, w: cut.x - a.x, h: cut.h },
      { x: cut.x + cut.w, y: cut.y, w: a.x + a.w - (cut.x + cut.w), h: cut.h },
    ];
    return parts.filter((p) => p.w >= 1.5 && p.h >= 4);
  };
  const hitTest = document.createElement("style");
  hitTest.textContent = "* { pointer-events: auto !important; }";
  document.head.append(hitTest);

  /** The parts of a rect that every clipping ancestor lets through and no
   * opaque layer covers. A menu that opens over half a word leaves the other
   * half to be measured, without the menu's own pixels in its box. */
  const veiled = new Set<Element>();
  const visibleParts = (el: Element, rect: Box): Box[] => {
    let box: Box | null = intersect(rect, viewport);
    for (let e: Element | null = el; e && box; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        box = intersect(box, boxOf(e.getBoundingClientRect()));
      }
    }
    if (!box) return [];
    /* Sampled every 4px on two lines: a popup corner over the end of a
       word is found, not only one over its middle. */
    const points: [number, number][] = [];
    for (const fy of [0.3, 0.7]) {
      for (let x = box.x + 1; x < box.x + box.w; x += 4) {
        points.push([x, box.y + box.h * fy]);
      }
    }
    const covers = points.map(([x, y]) => coveredAt(el, x, y));
    if (covers.every((c) => c?.kind === "opaque")) return [];
    if (covers.some((c) => c !== null)) {
      /* Behind a modal's scrim the page is inert: not text the user reads. */
      if (el.closest('[inert], [aria-hidden="true"]')) return [];
    }
    if (covers.some((c) => c?.kind === "veil")) veiled.add(el);
    let parts: Box[] = [box];
    for (const cover of covers) {
      if (cover?.kind !== "opaque") continue;
      const over = boxOf(cover.by.getBoundingClientRect());
      parts = parts.flatMap((p) => subtract(p, over));
    }
    for (const { owner, shadow } of pinnedShadows) {
      if (owner.contains(el)) continue;
      parts = parts.flatMap((p) => subtract(p, shadow));
    }
    /* A line a cover or a scroll edge cuts through leaves the tops or tails
       of its glyphs: strokes too thin to hold a full pixel of colour. The
       line is read where it is whole, at another scroll position. */
    return parts.filter((p) => p.h >= 0.6 * rect.h);
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
    /* Selected text is painted in its ::selection colours, which the computed
       style of the element does not carry. */
    const selection = document.getSelection();
    const selected =
      selection !== null &&
      !selection.isCollapsed &&
      selection.containsNode(el, true);
    if (args.selectionSelectors) {
      /* Only text whose ::selection the page styles: the rest is painted with
         the neutral highlight probePage lays under the author's rules, which
         is the text at rest, already measured. */
      const styled = args.selectionSelectors.some((sel) => {
        try {
          return el.matches(sel);
        } catch {
          return false;
        }
      });
      if (!selected || !styled) return;
    }
    /* Transparent text can still be painted, by a text-shadow; then only the
       pixels say what was drawn. */
    const shadowed = cs.textShadow !== "none";
    if (color && color[3] === 0 && !clipText && !shadowed) return;
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
      color:
        clipText || selected || veiled.has(el) || (color && color[3] === 0)
          ? null
          : color,
      veiled: veiled.has(el),
    });
  };

  /* While a modal dialog is open the page under it is inactive: dimmed by a
     scrim on purpose and unreachable until the dialog closes. A dialog is
     modal when it says so (aria-modal, <dialog open>, alertdialog) or when
     it hides the rest of the page from assistive tech, as Base UI's does
     with aria-hidden on the app root. Text in the dialog, and in anything
     layered after it (a select's listbox, a toast), is still measured; a
     non-modal popover leaves the page active. */
  const modals = [
    ...document.querySelectorAll(
      '[aria-modal="true"], dialog[open], [role="alertdialog"], [role="dialog"]',
    ),
  ].filter((m) => {
    const r = m.getBoundingClientRect();
    return (
      r.width > 1 &&
      r.height > 1 &&
      getComputedStyle(m).visibility === "visible"
    );
  });
  const declaredModal = (m: Element) =>
    m.getAttribute("aria-modal") === "true" ||
    m.tagName === "DIALOG" ||
    m.getAttribute("role") === "alertdialog";
  const underModal = (el: Element) =>
    modals.some(
      (m) =>
        !m.contains(el) &&
        !(m.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        (declaredModal(m) ||
          el.closest('[aria-hidden="true"], [inert]') !== null),
    );

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    const value = node.textContent ?? "";
    if (!el || !value.trim()) continue;
    if (only && !el.closest(only)) continue;
    if (underModal(el)) continue;
    if (el.closest(SKIP) || el.closest(DISABLED) || hidden(el)) continue;
    const range = document.createRange();
    const rects: Box[] = [];
    let start = -1;
    const flush = (end: number) => {
      if (start < 0) return;
      /* A word of punctuation alone (the full stop a JSX expression split off
         from its sentence) is a dot a pixel or two wide: no pixel of it is
         ever fully covered, so its strongest pixel understates the colour.
         Its colour is the run's, measured on the run's other words. */
      if (!/[\p{L}\p{N}]/u.test(value.slice(start, end))) {
        start = -1;
        return;
      }
      range.setStart(node, start);
      range.setEnd(node, end);
      let found = [...range.getClientRects()].map(boxOf);
      if (found.length === 0 && el instanceof SVGElement) {
        found = [boxOf(el.getBoundingClientRect())];
      }
      for (const r of found) {
        if (r.w < 1.5 || r.h < 4) continue;
        rects.push(...visibleParts(el, r));
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
  for (const field of only ? [] : scope.querySelectorAll(FIELDS)) {
    if (underModal(field)) continue;
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
    const parts = visibleParts(field, box);
    if (parts.length > 0) add(field, text, parts, text !== value.trim());
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
::selection {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
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
  /* Wait for the style to reach the screen in real time: two of the page's
     animation frames can pass before the compositor paints the change, and a
     screenshot taken then would still show the glyphs it was meant to hide. */
  await page.evaluate(() => document.body.getBoundingClientRect());
  await page.waitForTimeout(60);
}

/* Runs in the analysis page: decodes both shots and measures every run. */
async function analyse(input: {
  shown: string;
  bare: string;
  runs: TextRun[];
  origin: { x: number; y: number };
  scale: number;
  glyphDelta: number;
}): Promise<(Measurement | null)[]> {
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
    if (changed === 0 && run.veiled) return null;
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
  /** Measure only text inside elements matching this selector. */
  only?: string;
  /** Measure only selected text inside elements these selectors match: the
   * author's ::selection rules with the pseudo-element taken off. */
  selectionSelectors?: string[];
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
  /* An entrance transition caught halfway measures text at a fraction of its
     opacity; every finite animation is run to its end state first. One that
     never ends (a spinner) cannot be finished and stays paused. */
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      try {
        animation.finish();
      } catch {
        // An infinite animation has no end state.
      }
    }
  });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await scrollState(page);
      const { runs, scroll } = await page.evaluate(collectRuns, {
        scope: options.scope ?? null,
        only: options.only ?? null,
        selectionSelectors: options.selectionSelectors ?? null,
      });
      if (runs.length === 0) return [];
      const clip =
        options.scope && options.pad !== undefined
          ? await scopeClip(page, options.scope, options.pad)
          : null;
      if (options.pad !== undefined && !clip) return [];
      const shot = async () =>
        (
          await page.screenshot({
            /* A screenshot waits for web fonts and a fresh frame; on a page
               busy compiling or animating that outlasts the 15s action
               limit, without anything being wrong. */
            timeout: 60_000,
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
      const measured = await analysisPage.evaluate(analyse, {
        shown,
        bare,
        runs,
        origin: clip ? { x: clip.x, y: clip.y } : { x: 0, y: 0 },
        scale: DEVICE_SCALE,
        glyphDelta: GLYPH_DELTA,
      });
      return measured.filter((m): m is Measurement => m !== null);
    }
    throw new Error("the page kept scrolling while it was being measured");
  } finally {
    await setStyle(page, "__cp_freeze", null);
  }
}

/* Generated text (::before / ::after content) and ordered-list markers are
   painted with no text node behind them, so the text walk never meets them.
   Runs in the page: each becomes a real span carrying the pseudo-element's
   computed style, in the pseudo-element's place, until restoreGenerated(). */
function materializeGenerated(): number {
  const PRIVATE_USE = /[-]/u;
  const NO_CHILDREN = new Set([
    "INPUT",
    "IMG",
    "BR",
    "HR",
    "SELECT",
    "TEXTAREA",
    "VIDEO",
    "CANVAS",
    "IFRAME",
  ]);
  const textOf = (content: string, el: Element) => {
    let out = "";
    const token =
      /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([\w-]+)\s*\)/g;
    for (const m of content.matchAll(token)) {
      out += m[3]
        ? (el.getAttribute(m[3]) ?? "")
        : (m[1] ?? m[2]).replace(/\\(.)/g, "$1");
    }
    return out;
  };
  const copyStyle = (from: CSSStyleDeclaration, to: HTMLElement) => {
    for (let i = 0; i < from.length; i++) {
      const prop = from[i];
      to.style.setProperty(prop, from.getPropertyValue(prop));
    }
  };
  const roman = (n: number) => {
    const table: [number, string][] = [
      [1000, "m"],
      [900, "cm"],
      [500, "d"],
      [400, "cd"],
      [100, "c"],
      [90, "xc"],
      [50, "l"],
      [40, "xl"],
      [10, "x"],
      [9, "ix"],
      [5, "v"],
      [4, "iv"],
      [1, "i"],
    ];
    let out = "";
    let rest = n;
    for (const [value, glyph] of table) {
      while (rest >= value) {
        out += glyph;
        rest -= value;
      }
    }
    return out;
  };
  const markerText = (li: Element, type: string) => {
    if (/^["']/.test(type)) return type.slice(1, -1);
    if (/^(?:none|disc|circle|square|disclosure-\w+)$/.test(type)) return "";
    const list = li.parentElement;
    const siblings = list
      ? [...list.children].filter(
          (c) => getComputedStyle(c).display === "list-item",
        )
      : [li];
    const start = list instanceof HTMLOListElement ? list.start : 1;
    const n = start + siblings.indexOf(li);
    const letter = (k: number) => String.fromCharCode(96 + ((k - 1) % 26) + 1);
    const label =
      type === "decimal-leading-zero"
        ? String(n).padStart(2, "0")
        : /^lower-(?:alpha|latin)$/.test(type)
          ? letter(n)
          : /^upper-(?:alpha|latin)$/.test(type)
            ? letter(n).toUpperCase()
            : type === "lower-roman"
              ? roman(n)
              : type === "upper-roman"
                ? roman(n).toUpperCase()
                : String(n);
    return `${label}. `;
  };

  let count = 0;
  let host = 0;
  const hostId = (el: Element) => {
    let id = el.getAttribute("data-cp-gid");
    if (!id) {
      host++;
      id = `g${host}`;
      el.setAttribute("data-cp-gid", id);
    }
    return id;
  };
  for (const el of [...document.body.querySelectorAll("*")]) {
    if (NO_CHILDREN.has(el.tagName) || el instanceof SVGElement) continue;
    for (const which of ["before", "after"] as const) {
      const cs = getComputedStyle(el, `::${which}`);
      const text = textOf(cs.content, el);
      /* An icon font draws a glyph from the private use area: a graphic,
         held to 3:1 by WCAG 1.4.11, not text. */
      if (!text.trim() || PRIVATE_USE.test(text)) continue;
      const span = document.createElement("span");
      copyStyle(cs, span);
      span.textContent = text;
      span.setAttribute("data-cp-generated", which);
      span.setAttribute("data-cp-id", `${hostId(el)}::${which}`);
      el.setAttribute(`data-cp-hide-${which}`, "");
      if (which === "before") el.prepend(span);
      else el.append(span);
      count++;
    }
    const own = getComputedStyle(el);
    if (own.display !== "list-item" || own.listStyleImage !== "none") continue;
    const text = markerText(el, own.listStyleType);
    if (!text.trim()) continue;
    const marker = getComputedStyle(el, "::marker");
    const span = document.createElement("span");
    for (const prop of [
      "color",
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "line-height",
      "-webkit-text-fill-color",
    ]) {
      span.style.setProperty(prop, marker.getPropertyValue(prop));
    }
    span.style.whiteSpace = "pre";
    if (own.listStylePosition !== "inside") {
      if (own.position === "static") {
        el.setAttribute("data-cp-was-static", "");
        (el as HTMLElement).style.position = "relative";
      }
      span.style.position = "absolute";
      span.style.right = "100%";
      span.style.top = "0";
    }
    span.textContent = text;
    span.setAttribute("data-cp-generated", "marker");
    span.setAttribute("data-cp-id", `${hostId(el)}::marker`);
    el.setAttribute("data-cp-hide-marker", "");
    el.prepend(span);
    count++;
  }
  if (count > 0) {
    const style = document.createElement("style");
    style.id = "__cp_generated";
    style.textContent = `[data-cp-hide-before]::before, [data-cp-hide-after]::after { content: none !important; }
[data-cp-hide-marker] { list-style-type: none !important; }`;
    document.head.append(style);
  }
  return count;
}

function restoreGenerated() {
  for (const span of document.querySelectorAll("[data-cp-generated]")) {
    span.remove();
  }
  for (const attr of ["before", "after", "marker"]) {
    for (const el of document.querySelectorAll(`[data-cp-hide-${attr}]`)) {
      el.removeAttribute(`data-cp-hide-${attr}`);
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>(
    "[data-cp-was-static]",
  )) {
    el.style.position = "";
    el.removeAttribute("data-cp-was-static");
  }
  document.getElementById("__cp_generated")?.remove();
}

/* Runs in the page. Selects the whole document. Text the page gives no
   ::selection style would show the browser's own highlight; a layer declared
   before every stylesheet repaints that as the text at rest, and any author
   rule, layered later or unlayered, still wins over it. */
function selectEverything() {
  const neutral = document.createElement("style");
  neutral.id = "__cp_neutral_selection";
  neutral.textContent =
    "@layer cp-neutral-selection { ::selection { background-color: transparent; color: inherit; -webkit-text-fill-color: inherit; } }";
  document.head.prepend(neutral);
  document.getSelection()?.selectAllChildren(document.body);
}

/* Runs in the page and returns what each author ::selection rule applies to.
   Without such a rule the browser paints its own highlight, which is not the
   page's to answer for; with one, selected text is a state the page styled,
   and it is measured selected. */
function selectionRuleSubjects(): string[] {
  const subjects = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText.includes("::selection")
      ) {
        for (const part of rule.selectorText.split(",")) {
          if (!part.includes("::selection")) continue;
          const subject = part.replace(/::selection/g, "").trim();
          subjects.add(
            subject === "" || /[\s>+~]$/.test(subject)
              ? `${subject} *`.trim()
              : subject,
          );
        }
      }
      if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // A cross-origin sheet (web fonts) has no readable rules.
    }
  }
  return [...subjects];
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

/** Loads a page, waiting out a dev server restart: serve.mjs starts next dev
 * again when its capped heap runs out, and a load in that window finds no
 * server. Any other failure is the page's and is thrown. */
export async function load(page: Page, url: string) {
  /* Also a navigation the page started itself (a click's router.push landing
     late) cutting this one short: the load is simply made again. */
  const NO_SERVER =
    /ERR_EMPTY_RESPONSE|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|interrupted by another navigation/;
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      return;
    } catch (error) {
      if (attempt >= 4 || !NO_SERVER.test(String(error))) throw error;
      await page.waitForTimeout(15_000);
    }
  }
}

/** How far ahead pending timeouts are run: content a page shows after a
 * delay (a poll result, a toast, a "still working" hint) is measured as
 * shown. */
export const TIMER_HORIZON_MS = 5 * 60_000;

/* Runs in the page before any of its scripts. Every setTimeout is recorded
   so releaseTimers can run the ones due within the horizon now. Not
   Playwright's fake clock: that also fakes requestAnimationFrame and
   setInterval, which stalled CSS reveals, fired webpack's chunk timeout and
   set a 30s poll firing in a loop. Here time stays real, intervals keep
   their pace, and only pending timeouts are brought forward. */
export function recordTimeouts() {
  const pending = new Map<
    number,
    { fn: (...args: unknown[]) => void; args: unknown[]; due: number }
  >();
  const set = window.setTimeout.bind(window);
  const clear = window.clearTimeout.bind(window);
  const wrapped = ((
    handler: TimerHandler,
    ms?: number,
    ...args: unknown[]
  ): number => {
    if (typeof handler !== "function") return set(handler, ms, ...args);
    /* The bundler's own timers are not the page's content: webpack gives
       each chunk load a 120s timeout, and running it early fails the load
       (ChunkLoadError). They are left on real time. */
    if (
      /\/_next\/static\/chunks\/(?:webpack|turbopack)/.test(
        new Error().stack ?? "",
      )
    ) {
      return set(handler, ms, ...args);
    }
    const id: number = set(() => {
      pending.delete(id);
      handler(...args);
    }, ms);
    pending.set(id, {
      fn: handler as (...a: unknown[]) => void,
      args,
      due: performance.now() + (ms ?? 0),
    });
    return id;
  }) as typeof window.setTimeout;
  window.setTimeout = wrapped;
  window.clearTimeout = ((id?: number) => {
    if (id !== undefined) pending.delete(id);
    clear(id);
  }) as typeof window.clearTimeout;
  (
    window as unknown as { __cpRelease?: (horizon: number) => number }
  ).__cpRelease = (horizon) => {
    let fired = 0;
    /* A timeout that schedules another is followed a few rounds. */
    for (let round = 0; round < 5; round++) {
      const now = performance.now();
      const due = [...pending].filter(([, t]) => t.due - now <= horizon);
      if (due.length === 0) break;
      for (const [id, t] of due) {
        pending.delete(id);
        clear(id);
        fired++;
        try {
          t.fn(...t.args);
        } catch {
          // The page's own error, reported by the page.
        }
      }
    }
    return fired;
  };
}

export async function releaseTimers(page: Page) {
  await page.evaluate(
    (horizon) =>
      (
        window as unknown as { __cpRelease?: (h: number) => number }
      ).__cpRelease?.(horizon),
    TIMER_HORIZON_MS,
  );
  await page.waitForTimeout(300);
}

/** Measures every text run on the page at rest, scrolling the main scroller
 * through its whole height and then every inner scroller through its own:
 * text nodes, field values and placeholders, generated content and list
 * markers, and, where the page styles ::selection, selected text. Closed
 * <details> are opened first, since their content is one click from being
 * read. A run seen at several positions keeps its worst. */
export async function probePage(page: Page, analysisPage: Page) {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("details:not([open])")) {
      (details as HTMLDetailsElement).open = true;
    }
  });
  const selectionSelectors = await page.evaluate(selectionRuleSubjects);
  const worst = new Map<string, Measurement>();
  const keep = (m: Measurement) => {
    const seen = worst.get(m.key);
    if (!seen || m.ratio < seen.ratio) worst.set(m.key, m);
  };
  for (const y of await scrollTargets(page)) {
    await page.evaluate((top) => {
      const target =
        document.querySelector<HTMLElement>("[data-cp-scroller]") ??
        (document.scrollingElement as HTMLElement);
      target.scrollTop = top;
    }, y);
    await page.waitForTimeout(150);
    for (const m of await probeViewport(page, analysisPage)) keep(m);
    if (selectionSelectors.length > 0) {
      await page.evaluate(selectEverything);
      try {
        for (const m of await probeViewport(page, analysisPage, {
          selectionSelectors,
        })) {
          keep({
            ...m,
            key: `${m.key} [selected]`,
            where: `${m.where} [selected]`,
          });
        }
      } finally {
        await page.evaluate(() => {
          document.getSelection()?.removeAllRanges();
          document.getElementById("__cp_neutral_selection")?.remove();
        });
      }
    }
    if ((await page.evaluate(materializeGenerated)) > 0) {
      try {
        for (const m of await probeViewport(page, analysisPage, {
          only: "[data-cp-generated]",
        })) {
          keep(m);
        }
      } finally {
        await page.evaluate(restoreGenerated);
      }
    }
  }
  /* A strip that scrolls sideways, or a panel with its own scrollbar, hides
     text the main scroll never reaches: each is scrolled through on its own. */
  const inner = await page.evaluate(markInnerScrollers);
  for (let i = 0; i < inner; i++) {
    const scope = `[data-cp-inner="${i}"]`;
    const positions = await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return [];
      /* Centred, not "nearest": nearest can park a short strip under the
         sticky top bar, where it is covered and never measured. */
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const steps = (size: number, view: number) => {
        const step = Math.max(40, Math.floor(view * 0.8));
        const out: number[] = [];
        for (let v = 0; v < size - view + step; v += step) {
          out.push(Math.min(v, Math.max(0, size - view)));
        }
        return [...new Set(out)];
      };
      const out: [number, number][] = [];
      for (const top of steps(el.scrollHeight, el.clientHeight)) {
        for (const left of steps(el.scrollWidth, el.clientWidth)) {
          out.push([top, left]);
        }
      }
      return out;
    }, scope);
    for (const [top, left] of positions) {
      await page.evaluate(
        ([sel, y, x]) => {
          const el = document.querySelector<HTMLElement>(sel as string);
          if (el) {
            el.scrollTop = y as number;
            el.scrollLeft = x as number;
          }
        },
        [scope, top, left] as const,
      );
      await page.waitForTimeout(100);
      for (const m of await probeViewport(page, analysisPage, { scope })) {
        keep(m);
      }
    }
    await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      }
    }, scope);
  }
  return [...worst.values()];
}

/* Runs in the page. Marks every visible element, other than the main
   scroller, that scrolls its own content on either axis. */
function markInnerScrollers(): number {
  const main = document.querySelector("[data-cp-scroller]");
  const scrolls = (overflow: string) =>
    overflow === "auto" || overflow === "scroll";
  let count = 0;
  for (const el of document.querySelectorAll<HTMLElement>("body *")) {
    if (el === main) continue;
    const cs = getComputedStyle(el);
    const vertical =
      scrolls(cs.overflowY) && el.scrollHeight > el.clientHeight + 8;
    const horizontal =
      scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth + 8;
    if (!vertical && !horizontal) continue;
    if (
      cs.visibility !== "visible" ||
      el.clientWidth < 8 ||
      el.clientHeight < 8
    ) {
      continue;
    }
    el.setAttribute("data-cp-inner", String(count));
    count++;
  }
  return count;
}

/** Visible content no text walk can read: a frame's document, an embedded
 * object. The lane fails on any, rather than passing what it never saw. */
export function unreadableContent(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("iframe, frame, embed, object")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      })
      .map((el) =>
        `${el.tagName.toLowerCase()} ${el.getAttribute("title") ?? el.getAttribute("src") ?? ""}`.trim(),
      ),
  );
}

const INTERACTIVE =
  'a[href], button, summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="link"], input[type="submit"], input[type="button"], [tabindex="0"]';
const DISCLOSURE =
  '[aria-expanded="false"], [aria-haspopup]:not([aria-haspopup="false"])';
const TOGGLE =
  'input[type="checkbox"], [role="checkbox"], [role="switch"], [role="menuitemcheckbox"]';
/* A button that declares nothing about what it opens. Submit and reset
   buttons are left out: they send the form, which is a flow, not a state. */
const PLAIN_BUTTON =
  'button:not([aria-expanded]):not([aria-haspopup]):not([role="switch"]):not([role="checkbox"]):not([role="tab"]), [role="button"]:not(button):not(a):not([aria-expanded]):not([aria-haspopup])';

export type InteractiveState =
  | "hover"
  | "focus"
  | "active"
  | "open"
  | "checked"
  | "loading"
  | "target";

export interface StateMeasurement extends Measurement {
  state: InteractiveState;
  /** The target whose state this is: the menu that was opened, the row that
   * was hovered. */
  of: string;
}

export interface InteractiveProbe {
  measurements: StateMeasurement[];
  /** Targets whose states could not be measured, with the reason. The lane
   * fails on any: a target that is never measured is not known to pass. */
  skipped: string[];
  /** Controls that left the page when pressed. Their states were measured
   * before the press was released; the page is reloaded after each. */
  navigated: string[];
  /** Targets visited, by kind. */
  visited: Record<TargetKind, number>;
  /** Requests that would have changed something on the server, refused while
   * plain buttons were clicked. */
  blocked: string[];
  /** Times the page was loaded again to undo what a target did. */
  reloads: number;
}

export type TargetKind =
  | "control"
  | "hover"
  | "disclosure"
  | "toggle"
  | "loading"
  | "target"
  | "click";

export const ALL_KINDS: readonly TargetKind[] = [
  "control",
  "hover",
  "disclosure",
  "toggle",
  "loading",
  "target",
  "click",
];

/** Marks every target in document order and returns how many there are: every
 * enabled control that carries text, every element a :hover rule in the page's
 * stylesheets matches (a card, a row, a group-hover child), every disclosure,
 * every checkbox or switch, every shared Button (put in its loading state) and
 * every element with an id that a :target rule restyles. No cap. */
function markTargets(page: Page, only: readonly TargetKind[]) {
  return page.evaluate(
    ([controlSel, disclosureSel, toggleSel, plainSel, wanted]) => {
      for (const el of document.querySelectorAll("[data-cp-target]")) {
        el.removeAttribute("data-cp-target");
        el.removeAttribute("data-cp-kind");
      }
      const DISABLED =
        ':disabled, [aria-disabled="true"], button:disabled *, fieldset:disabled *';
      /* Rendered, and somewhere the page can scroll to: a drawer parked
         off-canvas (the phone sidebar before its trigger opens it) or an
         inert background is not reachable until something else opens it. */
      const shown = (el: Element) => {
        if (getComputedStyle(el).visibility !== "visible") return false;
        for (let e: Element | null = el; e; e = e.parentElement) {
          if (getComputedStyle(e).display === "none") return false;
        }
        if (el.closest('[inert], [aria-hidden="true"]')) return false;
        const r = el.getBoundingClientRect();
        const width = Math.max(
          innerWidth,
          document.documentElement.scrollWidth,
        );
        return r.right > 0 && r.left < width && r.bottom + scrollY > 0;
      };
      const labelled = (el: Element) =>
        (el.textContent ?? "").trim() !== "" ||
        (el instanceof HTMLInputElement && el.value.trim() !== "");

      /* A selector with :hover, nesting resolved, minus the :hover, matches
         the element whose paint changes; hovering it also hovers every
         ancestor, so group-hover and .card:hover .title both fire. */
      const hoverSelectors = new Set<string>();
      const targetSelectors = new Set<string>();
      const resolve = (child: string, parent: string | null) => {
        if (!parent) return child;
        return child.includes("&")
          ? child.replaceAll("&", `:is(${parent})`)
          : `:is(${parent}) ${child}`;
      };
      const walkRules = (rules: CSSRuleList, parent: string | null) => {
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule) {
            const selector = resolve(rule.selectorText, parent);
            if (selector.includes(":hover")) hoverSelectors.add(selector);
            if (selector.includes(":target")) targetSelectors.add(selector);
            if (rule.cssRules.length) walkRules(rule.cssRules, selector);
          } else if ("cssRules" in rule) {
            walkRules((rule as CSSGroupingRule).cssRules, parent);
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          walkRules(sheet.cssRules, null);
        } catch {
          // A cross-origin sheet (web fonts) has no readable rules.
        }
      }
      const matchedWithout = (selectors: Set<string>, pseudo: RegExp) => {
        const found = new Set<Element>();
        for (const selector of selectors) {
          const bare = selector
            .replace(pseudo, "")
            .replace(/\(\s*\)/g, "(*)")
            .trim();
          try {
            for (const el of document.querySelectorAll(bare || "*")) {
              found.add(el);
            }
          } catch {
            // A selector that is invalid once the state is gone matches nothing.
          }
        }
        return found;
      };
      const hoverTargets = matchedWithout(hoverSelectors, /:hover/g);
      /* :target applies to the element whose id is in the URL hash; the
         subject may be that element or something after it, so the id is
         looked for on the matched element and its ancestors. */
      const targetTargets = new Set<Element>();
      for (const el of matchedWithout(targetSelectors, /:target/g)) {
        const withId = el.closest("[id]");
        if (withId) targetTargets.add(withId);
      }

      const kinds = new Map<Element, Set<string>>();
      const want = new Set(wanted as string[]);
      const mark = (el: Element, kind: string) => {
        if (!want.has(kind)) return;
        if (el.closest(DISABLED) || !shown(el)) return;
        const set = kinds.get(el) ?? new Set<string>();
        set.add(kind);
        kinds.set(el, set);
      };
      for (const el of document.querySelectorAll(controlSel as string)) {
        if (labelled(el)) mark(el, "control");
      }
      for (const el of hoverTargets) {
        if (el === document.body || el === document.documentElement) continue;
        if (labelled(el)) mark(el, "hover");
      }
      for (const el of document.querySelectorAll(disclosureSel as string)) {
        if (el.tagName !== "SUMMARY") mark(el, "disclosure");
      }
      for (const el of document.querySelectorAll(toggleSel as string)) {
        mark(el, "toggle");
      }
      for (const el of document.querySelectorAll('[data-slot="button"]')) {
        if (labelled(el)) mark(el, "loading");
      }
      for (const el of targetTargets) {
        if (labelled(el)) mark(el, "target");
      }
      /* One click per kind of button: thirty date cells styled alike open
         the same component, and each click that changes the page costs a
         reload. Buttons are alike when tag, role, type, every class and
         their label match, digits aside ("12" and "13" are one kind; "Save"
         and "Delete" are two). */
      const clicked = new Set<string>();
      for (const el of document.querySelectorAll(plainSel as string)) {
        if (el instanceof HTMLButtonElement && el.type !== "button") continue;
        if (!labelled(el) && !el.getAttribute("aria-label")) continue;
        if (el.closest(DISABLED) || !shown(el)) continue;
        const signature = [
          el.tagName,
          el.getAttribute("role") ?? "",
          el.getAttribute("type") ?? "",
          [...el.classList].sort().join(" "),
          (el.getAttribute("aria-label") ?? el.textContent ?? "")
            .trim()
            .replace(/\d/g, "#"),
        ].join("|");
        if (clicked.has(signature)) continue;
        clicked.add(signature);
        mark(el, "click");
      }
      const ordered = [...kinds.keys()].sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      );
      for (const [i, el] of ordered.entries()) {
        el.setAttribute("data-cp-target", String(i));
        el.setAttribute(
          "data-cp-kind",
          [...(kinds.get(el) as Set<string>)].join(" "),
        );
      }
      return ordered.length;
    },
    [INTERACTIVE, DISCLOSURE, TOGGLE, PLAIN_BUTTON, only] as const,
  );
}

/** Every state a target can be put in without leaving the page: hover, press
 * and keyboard focus on each control, hover on each element a :hover rule
 * restyles, each disclosure open, each checkbox and switch flipped. A control
 * too small to hover (a visually hidden skip link) is still focused, since
 * focus is how it appears. */
export async function probeInteractive(
  page: Page,
  analysisPage: Page,
  options: {
    kinds?: readonly TargetKind[];
    /** Told when a plain-button click starts and when its page is restored.
     * A refused write surfaces in the page as a failed fetch; the caller
     * keeps errors from that window apart from the page's own. */
    onClicking?: (active: boolean) => void;
  } = {},
): Promise<InteractiveProbe> {
  const kinds = options.kinds ?? ALL_KINDS;
  const startUrl = page.url();
  const sameDocument = (url: string) =>
    url.split("#")[0] === startUrl.split("#")[0];
  let count = await markTargets(page, kinds);
  const measurements: StateMeasurement[] = [];
  const skipped: string[] = [];
  const navigated: string[] = [];
  const visited: Record<TargetKind, number> = {
    control: 0,
    hover: 0,
    disclosure: 0,
    toggle: 0,
    loading: 0,
    target: 0,
    click: 0,
  };
  /* Clicking a plain button is how a page shows what it never declared (a
     menu revealed with no aria-expanded). It is also how a page deletes,
     approves and sends, so while targets are probed nothing but reads
     reaches the server: the click shows its state, and the seeded data,
     shared with the other routes in flight, stays as it was. */
  const blocked: string[] = [];
  const guard = async (route: Route) => {
    const method = route.request().method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      await route.fallback();
      return;
    }
    blocked.push(`${method} ${route.request().url()}`);
    await route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "refused by the contrast probe",
    });
  };
  if (kinds.includes("click")) await page.route("**/*", guard);
  let reloads = 0;
  const trace = (line: string) => {
    if (process.env.E2E_TRACE) {
      appendFileSync(
        process.env.E2E_TRACE,
        `${new Date().toISOString()} ${startUrl} ${line}\n`,
      );
    }
  };
  /* A reload undoes what the probe did, but what the probe did can still
     show: a view a click saved to localStorage renders differently on the
     client than on the server, and React reports the hydration mismatch.
     Errors in that window are the probe's, reported with the click errors. */
  const reload = async () => {
    reloads++;
    trace("  reload");
    options.onClicking?.(true);
    try {
      await load(page, startUrl);
      await page.waitForTimeout(500);
      count = await markTargets(page, kinds);
    } finally {
      options.onClicking?.(false);
    }
  };
  /** Waits until the page stops changing after an action, so a state is
   * measured where it lands, not mid-way through a script-driven slide:
   * 300ms without a class, style or node change, at most 3s. */
  const quiet = () =>
    page.evaluate(
      () =>
        new Promise<void>((done) => {
          let timer = setTimeout(finish, 300);
          const stop = setTimeout(finish, 3000);
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(finish, 300);
          });
          function finish() {
            observer.disconnect();
            clearTimeout(timer);
            clearTimeout(stop);
            done();
          }
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class", "style"],
          });
        }),
    );
  /* What a state changes is measured with it. A tooltip or popover is often
     rendered in a portal, far from the control in the DOM and outside its
     box; a disclosure shows content that was already there by flipping an
     attribute. Every element added, and every element whose class, style or
     visibility attribute changed, outside the target and its ancestors, is
     marked and measured in that state. The rest of the page was measured at
     rest and is not measured again under an open menu's shadow. */
  const watchChanges = () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __cpChanged?: Element[];
        __cpObserver?: MutationObserver;
      };
      w.__cpChanged = [];
      w.__cpObserver?.disconnect();
      w.__cpObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (
            record.type === "attributes" &&
            record.target instanceof Element
          ) {
            w.__cpChanged?.push(record.target);
          }
          for (const node of record.addedNodes) {
            if (node instanceof Element) w.__cpChanged?.push(node);
          }
        }
      });
      w.__cpObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "hidden",
          "open",
          "data-state",
          "data-open",
          "aria-hidden",
        ],
      });
    });
  const markChanges = (scope: string) =>
    page.evaluate((sel) => {
      const w = window as unknown as {
        __cpChanged?: Element[];
        __cpObserver?: MutationObserver;
      };
      w.__cpObserver?.disconnect();
      const target = document.querySelector(sel);
      let marked = 0;
      for (const el of new Set(w.__cpChanged ?? [])) {
        if (!el.isConnected || el === document.body) continue;
        if (target && (target.contains(el) || el.contains(target))) continue;
        if (el.closest("[data-cp-generated]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        el.setAttribute("data-cp-popup", "");
        marked++;
      }
      w.__cpChanged = [];
      return marked;
    }, scope);
  const clearChanges = () =>
    page.evaluate(() => {
      for (const el of document.querySelectorAll("[data-cp-popup]")) {
        el.removeAttribute("data-cp-popup");
      }
    });
  let current = "";
  const record = (list: Measurement[], state: InteractiveState) => {
    for (const m of list) measurements.push({ ...m, state, of: current });
  };
  /** The target's own text in this state, then whatever the state changed.
   * `whole` measures the full viewport instead of the target: a checkbox or
   * a :target restyles its neighbours through CSS (peer-checked, :has()),
   * which changes no attribute a mutation observer could see. */
  const measure = async (
    state: InteractiveState,
    scope: string,
    whole = false,
  ) => {
    record(
      await probeViewport(page, analysisPage, whole ? {} : { scope, pad: 4 }),
      state,
    );
    if ((await markChanges(scope)) > 0) {
      try {
        record(
          await probeViewport(page, analysisPage, { only: "[data-cp-popup]" }),
          state,
        );
      } finally {
        await clearChanges();
      }
    }
  };

  const retried = new Set<number>();
  for (let i = 0; i < count; i++) {
    const selector = `[data-cp-target="${i}"]`;
    let target = page.locator(selector);
    if ((await target.count()) === 0) {
      await reload();
      target = page.locator(selector);
      if ((await target.count()) === 0) {
        skipped.push(`target ${i}: gone from the page after a reload`);
        continue;
      }
    }
    const is = new Set(
      ((await target.getAttribute("data-cp-kind")) ?? "").split(" "),
    ) as Set<TargetKind>;
    const name = `target ${i} (${[...is].join("+")}) "${((await target.textContent()) ?? "").trim().slice(0, 40)}"`;
    current = name;
    trace(`${i}/${count} ${name} reloads=${reloads}`);
    /* An earlier state of this same target can take it off the page: Escape
       after a press closes the dialog the target sits in. The page is loaded
       again (writes were refused, so the dialog comes back) before the next
       state is put on it. */
    const ensure = async () => {
      if (
        await page.evaluate((sel) => !!document.querySelector(sel), selector)
      ) {
        return;
      }
      await reload();
      if (
        !(await page.evaluate((sel) => !!document.querySelector(sel), selector))
      ) {
        throw new Error("left the page and did not come back on a reload");
      }
    };
    try {
      /* Not Playwright's scrollIntoViewIfNeeded: it waits for the element to
         stop moving, and a floating hero card never does. */
      await target.evaluate((el) =>
        el.scrollIntoView({ block: "center", inline: "nearest" }),
      );
      await page.waitForTimeout(100);
      if (is.has("control")) {
        trace("  control");
        visited.control++;
        await watchChanges();
        await page.evaluate((sel) => {
          (document.activeElement as HTMLElement | null)?.blur();
          document
            .querySelector<HTMLElement>(sel)
            ?.focus({ focusVisible: true } as FocusOptions);
        }, selector);
        await measure("focus", selector);
        await page.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.blur(),
        );
      }
      const box = await target.boundingBox();
      const hoverable = box !== null && box.width > 4 && box.height > 4;
      if (hoverable && (is.has("control") || is.has("hover"))) {
        if (is.has("hover")) visited.hover++;
        await watchChanges();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await measure("hover", selector);
        if (is.has("control")) {
          await page.mouse.down();
          await measure("active", selector);
          /* Releasing away from the control cancels the click, so pressing a
             link or a submit button does not leave the page. */
          await page.mouse.move(1, 1);
          await page.mouse.up();
          await page.keyboard.press("Escape");
        }
        await page.mouse.move(1, 1);
      }
      if (is.has("disclosure")) {
        trace("  disclosure");
        await ensure();
        visited.disclosure++;
        await watchChanges();
        await target.click({ timeout: 2000, force: !hoverable });
        await page.waitForTimeout(100);
        if (sameDocument(page.url())) await quiet();
        if (sameDocument(page.url())) {
          await measure("open", selector);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
          if ((await target.getAttribute("aria-expanded")) === "true") {
            await target.click({ timeout: 2000, force: true });
            await page.waitForTimeout(200);
          }
        }
      }
      if (is.has("toggle")) {
        trace("  toggle");
        await ensure();
        visited.toggle++;
        await watchChanges();
        await page.evaluate(
          (sel) => document.querySelector<HTMLElement>(sel)?.click(),
          selector,
        );
        await page.waitForTimeout(250);
        await measure("checked", selector, true);
        await page.evaluate(
          (sel) => document.querySelector<HTMLElement>(sel)?.click(),
          selector,
        );
        await page.waitForTimeout(150);
      }
      if (is.has("loading")) {
        trace("  loading");
        await ensure();
        visited.loading++;
        /* The shared Button's loading state is its data-loading attribute and
           aria-busy, which every data-loading: style keys on; set here, it
           shows each button's loading paint without submitting anything. */
        const added = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el || el.hasAttribute("data-loading")) return false;
          el.setAttribute("data-loading", "");
          el.setAttribute("aria-busy", "true");
          return true;
        }, selector);
        await measure("loading", selector);
        if (added) {
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            el?.removeAttribute("data-loading");
            el?.removeAttribute("aria-busy");
          }, selector);
        }
      }
      if (is.has("click")) {
        trace("  click");
        await ensure();
        visited.click++;
        options.onClicking?.(true);
        await watchChanges();
        await target.evaluate((el) => (el as HTMLElement).click());
        await page.waitForTimeout(100);
        if (sameDocument(page.url())) await quiet();
        if (sameDocument(page.url())) {
          const changed = await page.evaluate(
            () =>
              (window as unknown as { __cpChanged?: Element[] }).__cpChanged
                ?.length ?? 0,
          );
          if (changed > 0) {
            await measure("open", selector);
            /* The click may have changed anything; the next target starts
               from the page as it loaded. */
            await reload();
          }
        }
        options.onClicking?.(false);
      }
      if (is.has("target")) {
        trace("  target");
        await ensure();
        visited.target++;
        const id = await target.getAttribute("id");
        await page.evaluate(
          ([hash, sel]) => {
            location.hash = hash as string;
            /* The browser scrolls a target to the top edge, under a sticky
               top bar; it is brought to the middle to be read. */
            document
              .querySelector(sel as string)
              ?.scrollIntoView({ block: "center" });
          },
          [id ?? "", selector] as const,
        );
        await page.waitForTimeout(200);
        await measure("target", selector, true);
        await page.evaluate(() => {
          location.hash = "";
        });
        await page.waitForTimeout(100);
      }
    } catch (error) {
      /* The page left while this target was being measured: an earlier
         click's navigation landing late. That is not this target's doing,
         so it is measured again on the page reloaded, once. */
      const left = /Execution context was destroyed|navigat/i.test(
        String(error),
      );
      if (left && !retried.has(i)) {
        retried.add(i);
        await reload();
        i--;
        continue;
      }
      skipped.push(`${name}: ${String(error).split("\n")[0].slice(0, 160)}`);
    }
    if (!sameDocument(page.url())) {
      navigated.push(`${name}: ${page.url()}`);
      await reload();
    }
  }
  if (kinds.includes("click")) await page.unroute("**/*", guard);
  return { measurements, skipped, navigated, visited, blocked, reloads };
}

export function failures<T extends Measurement>(measurements: T[]): T[] {
  return measurements.filter((m) => m.ratio < m.required);
}
