// @vitest-environment node
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plannedOutline } from "@/components/design/sequence/fixtures";
import {
  draftFrom,
  removePoint,
} from "@/components/design/sequence/outline-model";
import {
  TOUCH_HEIGHT,
  TOUCH_SQUARE,
} from "@/components/design/sequence/outline-step";
import type { OutlineController } from "@/components/design/sequence/use-outline";
import { Button } from "@/components/ui/button";
import {
  DIALOG_CLOSE_CLASS,
  DIALOG_CONTENT_CLASS,
} from "@/components/ui/dialog";
import type { SerializedGeneration } from "@/lib/design/serialize";
import {
  appCssFor,
  launchChromium,
  pageHtml,
} from "@/lib/testing/browser-layout";
import { cn } from "@/lib/utils";
import {
  DIRECTIONS_POPUP_CLASS,
  DIRECTIONS_SCROLL_CLASS,
} from "./design-directions-dialog";
import {
  DirectionsFlowView,
  type DirectionsHandlers,
  type DirectionsView,
  dialogWidthFor,
} from "./directions-flow-view";
import { FlowChromeProvider } from "./flow-heading";

/* Round 4: the dialog's scroll box sat flush with its content, so it clipped
   the 2px-offset focus outline of every control on its edge ("Back", "Use
   this image", "Done", full-width buttons at 390px). The outline reaches 4px
   past the control; all of it must be inside the scroll box. */

const OUTLINE_REACH = 4;
const WIDTHS = [390, 768, 1440];

const noop = () => {};
const HANDLERS: DirectionsHandlers = {
  onUseOwnImage: noop,
  onLetKoCreate: noop,
  onNoImage: noop,
  onFile: noop,
  onRemoveImage: noop,
  onRetryUpload: noop,
  onUseImage: noop,
  onBackToChoice: noop,
  onRetryGeneration: noop,
  onChooseAnotherImage: noop,
  onRegenerate: noop,
  onSendToTeam: noop,
  onDone: noop,
};

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function generation(id: string, title: string): SerializedGeneration {
  return {
    id,
    url: PIXEL,
    renderer: "composite",
    provider: "composite",
    model: "satori",
    status: "succeeded",
    error: null,
    width: 1080,
    height: 1350,
    designType: "Instagram post",
    briefId: null,
    calendarItemId: null,
    headline: title,
    createdAt: "2026-10-21T00:00:00.000Z",
    direction: { title, reasons: ["Headline leads the eye"] },
    imageSource: "upload",
    editable: true,
    frame: null,
  };
}

const OUTLINE: OutlineController = {
  kind: "carousel",
  state: {
    status: "ready",
    draft: draftFrom(plannedOutline(5)),
    replanning: null,
    replanError: null,
  },
  ensure: noop,
  retry: noop,
  replan: noop,
  move: noop,
  edit: noop,
  add: () => null,
  remove: noop,
  restore: () => null,
  reset: noop,
};

const OUTLINE_AFTER_DELETE: OutlineController = {
  ...OUTLINE,
  state: {
    status: "ready",
    draft: removePoint(draftFrom(plannedOutline(6)), "p2"),
    replanning: null,
    replanError: null,
  },
};

const VIEWS: [string, DirectionsView][] = [
  ["outline", { step: "outline", outline: OUTLINE, starting: false }],
  ["choice", { step: "choose" }],
  [
    "upload preview",
    {
      step: "upload",
      upload: {
        status: "ready",
        key: "k",
        image: {
          name: "cake.png",
          bytes: 1000,
          previewUrl: PIXEL,
          width: 800,
          height: 800,
        },
      },
      waitingOnUpload: false,
    },
  ],
  [
    "unusable image",
    {
      step: "error",
      source: "upload",
      message: "This image can't be used. Choose another image.",
      unusableImage: true,
    },
  ],
  [
    "results",
    {
      step: "results",
      slots: [
        { id: "a", generation: generation("a", "Playful product story") },
        { id: "b", generation: generation("b", "Editorial arch frame") },
      ],
      source: "upload",
      imageName: "cake.png",
      regeneratingSlot: null,
      regenerateError: null,
      sendingId: null,
      sendNotices: {
        a: { tone: "sent", message: "Sent to the design team as DT-1042" },
      },
    },
  ],
];

function dialogMarkup(
  view: DirectionsView,
  { closeButton = false } = {},
): string {
  return renderToStaticMarkup(
    <div
      role="dialog"
      className={cn(
        DIALOG_CONTENT_CLASS,
        DIRECTIONS_POPUP_CLASS,
        dialogWidthFor(view),
      )}
    >
      <div data-testid="scroller" className={DIRECTIONS_SCROLL_CLASS}>
        <FlowChromeProvider value="static">
          <DirectionsFlowView
            entry="calendar"
            view={view}
            handlers={HANDLERS}
            koImagery={false}
          />
        </FlowChromeProvider>
      </div>
      {closeButton ? (
        <Button
          data-slot="dialog-close"
          data-testid="close"
          variant="ghost"
          size="icon-sm"
          className={DIALOG_CLOSE_CLASS}
          aria-label="Close"
        >
          x
        </Button>
      ) : null}
    </div>,
  );
}

let browser: Browser;
beforeAll(async () => {
  browser = await launchChromium();
});
afterAll(async () => {
  await browser?.close();
});

async function clippedOutlines(view: DirectionsView, width: number) {
  const markup = dialogMarkup(view);
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await page.setContent(pageHtml(markup, await appCssFor(markup), "light"));
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate((reach) => {
      const scroller = document.querySelector<HTMLElement>(
        "[data-testid=scroller]",
      );
      if (!scroller) throw new Error("scroller not rendered");
      const box = scroller.getBoundingClientRect();
      const top = box.top + scroller.clientTop - scroller.scrollTop;
      const left = box.left + scroller.clientLeft;
      const controls = scroller.querySelectorAll<HTMLElement>(
        "button, a[href], [tabindex='0'], input, textarea, select",
      );
      return [...controls].flatMap((el) => {
        const r = el.getBoundingClientRect();
        const sides = [
          r.left - reach < left - 0.5 && "left",
          r.right + reach > left + scroller.clientWidth + 0.5 && "right",
          r.top - reach < top - 0.5 && "top",
          r.bottom + reach > top + scroller.scrollHeight + 0.5 && "bottom",
        ].filter(Boolean);
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "")
          .trim()
          .slice(0, 40);
        return sides.length ? [`${name}: ${sides.join(", ")}`] : [];
      });
    }, OUTLINE_REACH);
  } finally {
    await page.close();
  }
}

/* Round 5: at rest every outline fitted, but Tab scrolls the next control
   into view flush with the scroller's edge, and the outline past that edge
   was cut off. Only a walk that scrolls, in a viewport short enough to need
   it, sees that. */
async function outlinesClippedWhileTabbing(
  view: DirectionsView,
  width: number,
  height: number,
) {
  const markup = dialogMarkup(view);
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.setContent(pageHtml(markup, await appCssFor(markup), "dark"));
    await page.evaluate(() => document.fonts.ready);
    const stops = await page
      .locator("[data-testid=scroller]")
      .evaluate(
        (scroller) =>
          scroller.querySelectorAll(
            "button, a[href], [tabindex='0'], input, textarea, select",
          ).length,
      );
    const clipped: string[] = [];
    let scrolled = false;
    for (let stop = 0; stop < stops; stop++) {
      await page.keyboard.press("Tab");
      /* Static markup carries no handlers; this is what REVEAL_ON_FOCUS
         does on focus in the app. */
      await page.evaluate(() => {
        const el = document.activeElement;
        if (el?.hasAttribute("data-reveal-on-focus")) {
          el.scrollIntoView({ block: "nearest" });
        }
      });
      const result = await page.evaluate((reach) => {
        const scroller = document.querySelector<HTMLElement>(
          "[data-testid=scroller]",
        );
        const el = document.activeElement as HTMLElement | null;
        if (!scroller || !el || !scroller.contains(el)) return null;
        const box = scroller.getBoundingClientRect();
        const top = box.top + scroller.clientTop;
        const left = box.left + scroller.clientLeft;
        const r = el.getBoundingClientRect();
        const sides = [
          r.left - reach < left - 0.5 && "left",
          r.right + reach > left + scroller.clientWidth + 0.5 && "right",
          r.top - reach < top - 0.5 && "top",
          r.bottom + reach > top + scroller.clientHeight + 0.5 && "bottom",
        ].filter(Boolean);
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "")
          .trim()
          .slice(0, 40);
        return {
          clip: sides.length ? `${name}: ${sides.join(", ")}` : null,
          scrollTop: scroller.scrollTop,
        };
      }, OUTLINE_REACH);
      if (!result) continue;
      if (result.scrollTop > 0) scrolled = true;
      if (result.clip) clipped.push(result.clip);
    }
    return { clipped, scrolled };
  } finally {
    await page.close();
  }
}

describe.each(VIEWS)("directions dialog, %s", (_name, view) => {
  it.each(WIDTHS)(
    "keeps every focus outline inside the scroll box at %ipx",
    async (width) => {
      expect(await clippedOutlines(view, width)).toEqual([]);
    },
  );
});

describe.each(["results", "outline"])(
  "directions dialog %s, tabbing through a scrolled list",
  (viewName) => {
    const results = VIEWS.find(([name]) => name === viewName)?.[1];
    if (!results) throw new Error(`${viewName} view missing`);

    it.each([
      [390, 700],
      [768, 600],
      [768, 900],
      [1024, 700],
      [1440, 700],
    ])(
      "keeps the focused outline inside the scroll box at %ipx x %ipx",
      async (width, height) => {
        const { clipped, scrolled } = await outlinesClippedWhileTabbing(
          results,
          width,
          height,
        );
        expect(scrolled).toBe(true);
        expect(clipped).toEqual([]);
      },
    );
  },
);

/* Round 5: at 640-1024px the results width replaced the base 2rem gutter
   and the popup ran from 0 to the viewport's edge. */
describe("directions dialog results width", () => {
  const results = VIEWS.find(([name]) => name === "results")?.[1];
  if (!results) throw new Error("results view missing");

  it.each([640, 768, 1024, 1100, 1440])(
    "leaves at least a 1rem gutter each side at %ipx",
    async (width) => {
      const markup = dialogMarkup(results);
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(
          pageHtml(markup, await appCssFor(markup), "light"),
        );
        const box = await page
          .getByRole("dialog")
          .evaluate((el) => el.getBoundingClientRect().toJSON());
        expect(box.left).toBeGreaterThanOrEqual(15.5);
        expect(width - box.right).toBeGreaterThanOrEqual(15.5);
        expect(box.width).toBeLessThanOrEqual(1024);
      } finally {
        await page.close();
      }
    },
  );
});

/* O3-ui round 1: a bare <select> inherits the base layer's 12px top and
   bottom padding, and in a 32px box that left 6px for the number, so the
   count read "-". jsdom computes no CSS; only a real layout sees it. */
describe("outline step count control", () => {
  const outline = VIEWS.find(([name]) => name === "outline")?.[1];
  if (!outline) throw new Error("outline view missing");

  it.each([
    [390, "light"],
    [390, "dark"],
    [1440, "light"],
    [1440, "dark"],
  ] as const)(
    "is the spec's 44px select with room for its number at %ipx, %s",
    async (width, theme) => {
      const markup = dialogMarkup(outline);
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(pageHtml(markup, await appCssFor(markup), theme));
        await page.evaluate(() => document.fonts.ready);
        const box = await page
          .getByRole("combobox", { name: "Number of slides" })
          .evaluate((el) => {
            const select = el as HTMLSelectElement;
            const style = getComputedStyle(select);
            const fontSize = Number.parseFloat(style.fontSize);
            return {
              height: select.getBoundingClientRect().height,
              textRoom:
                select.clientHeight -
                Number.parseFloat(style.paddingTop) -
                Number.parseFloat(style.paddingBottom),
              needed: fontSize * 1.2,
              shown: select.selectedOptions[0]?.textContent,
              textFits: select.scrollWidth <= select.clientWidth,
            };
          });
        expect(box.height).toBe(44);
        expect(box.textRoom).toBeGreaterThanOrEqual(box.needed);
        expect(box.shown).toBe("5");
        expect(box.textFits).toBe(true);
      } finally {
        await page.close();
      }
    },
  );

  /* A scrolled field under the X turns a tap on the field's corner into a
     close (it covered 19px of the hook's Point field at 390px). This scrolls
     the whole outline and checks no visible part of any control ever sits
     under it, on a phone, a touch tablet and a desktop. */
  it.each([
    [320, false],
    [390, false],
    [768, true],
    [768, false],
    [1440, false],
  ] as const)(
    "never scrolls a control under the close button at %ipx (touch: %s)",
    async (width, touch) => {
      const markup = dialogMarkup(
        { step: "outline", outline: OUTLINE_AFTER_DELETE, starting: false },
        { closeButton: true },
      );
      const context = await browser.newContext({
        viewport: { width, height: 640 },
        hasTouch: touch,
        isMobile: touch,
      });
      const page = await context.newPage();
      try {
        await page.setContent(
          pageHtml(markup, await appCssFor(markup), "light"),
        );
        await page.evaluate(() => document.fonts.ready);
        const report = await page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>(
            "[data-testid=scroller]",
          );
          const close = document.querySelector<HTMLElement>(
            "[data-testid=close]",
          );
          if (!scroller || !close) throw new Error("dialog not rendered");
          const x = close.getBoundingClientRect();
          const covered: string[] = [];
          const max = scroller.scrollHeight - scroller.clientHeight;
          for (let top = 0; top <= max + 8; top += 8) {
            scroller.scrollTop = Math.min(top, max);
            const view = scroller.getBoundingClientRect();
            for (const el of scroller.querySelectorAll<HTMLElement>(
              "button, input, select, textarea",
            )) {
              const r = el.getBoundingClientRect();
              const shownTop = Math.max(r.top, view.top);
              const shownBottom = Math.min(r.bottom, view.bottom);
              const overlapX =
                Math.min(r.right, x.right) - Math.max(r.left, x.left);
              const overlapY =
                Math.min(shownBottom, x.bottom) - Math.max(shownTop, x.top);
              if (overlapX > 0.5 && overlapY > 0.5) {
                covered.push(
                  `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)} at scrollTop ${scroller.scrollTop}`,
                );
              }
            }
          }
          return {
            covered: [...new Set(covered)],
            scrolled: max > 0,
            closeSize: [x.width, x.height],
          };
        });
        expect(report.scrolled).toBe(true);
        expect(report.covered).toEqual([]);
        expect(report.closeSize).toEqual(
          width < 640 || touch ? [44, 44] : [28, 28],
        );
      } finally {
        await context.close();
      }
    },
  );

  /* A row of their own costs every card 52px more scrolling. From 360px
     move and delete share the heading's row and the badge wraps instead,
     without touching them. */
  it.each([360, 390, 1440])(
    "keeps move and delete on the heading's row at %ipx",
    async (width) => {
      const markup = dialogMarkup({
        step: "outline",
        outline: OUTLINE_AFTER_DELETE,
        starting: false,
      });
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(
          pageHtml(markup, await appCssFor(markup), "light"),
        );
        await page.evaluate(() => document.fonts.ready);
        const rows = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("li[data-point]")]
            .filter((card) => card.querySelector("button[aria-label^=Delete]"))
            .map((card) => {
              const heading = card.querySelector("h3")?.getBoundingClientRect();
              const buttons = [
                ...card.querySelectorAll<HTMLElement>(
                  "button[aria-label^=Move], button[aria-label^=Delete]",
                ),
              ].map((b) => b.getBoundingClientRect());
              if (!heading || buttons.length !== 3) {
                throw new Error("card not rendered");
              }
              return {
                sameRow: buttons.every(
                  (b) => b.top < heading.bottom && b.bottom > heading.top,
                ),
                clear: heading.right <= Math.min(...buttons.map((b) => b.left)),
              };
            }),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.sameRow && r.clear)).toBe(true);
      } finally {
        await page.close();
      }
    },
  );

  /* UI spec 11.3: every tap target is at least 44px on a phone. Every
     control the step renders is measured, with a deleted slide so Undo is
     on screen, and move and delete must sit at least 8px apart. */
  it.each([320, 390])(
    "gives every control a 44px target, apart and inside its card, at %ipx",
    async (width) => {
      const markup = dialogMarkup({
        step: "outline",
        outline: OUTLINE_AFTER_DELETE,
        starting: false,
      });
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(
          pageHtml(markup, await appCssFor(markup), "light"),
        );
        await page.evaluate(() => document.fonts.ready);
        const report = await page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>(
            "[data-testid=scroller]",
          );
          if (!scroller) throw new Error("scroller not rendered");
          const name = (el: Element) =>
            (el.getAttribute("aria-label") ?? el.textContent ?? "")
              .trim()
              .slice(0, 40);
          const controls = [
            ...document.querySelectorAll<HTMLElement>(
              "button, input, select, textarea",
            ),
          ];
          const small = controls.flatMap((el) => {
            const r = el.getBoundingClientRect();
            return r.height < 44 || r.width < 44
              ? [`${name(el)}: ${r.width}x${r.height}`]
              : [];
          });
          const outside = [
            ...document.querySelectorAll<HTMLElement>("li[data-point]"),
          ].flatMap((card) => {
            const box = card.getBoundingClientRect();
            return [...card.querySelectorAll("button")].flatMap((b) => {
              const r = b.getBoundingClientRect();
              return r.left < box.left || r.right > box.right
                ? [`${name(b)} outside its card`]
                : [];
            });
          });
          const icons = [
            ...document.querySelectorAll<HTMLElement>(
              "li[data-point] button[aria-label^='Move'], li[data-point] button[aria-label^='Delete']",
            ),
          ].map((b) => ({ name: name(b), r: b.getBoundingClientRect() }));
          const crowded = icons.flatMap((a, i) =>
            icons.slice(i + 1).flatMap((b) => {
              const apart =
                Math.max(b.r.left - a.r.right, a.r.left - b.r.right) >= 8 ||
                Math.max(b.r.top - a.r.bottom, a.r.top - b.r.bottom) >= 8;
              return apart ? [] : [`${a.name} / ${b.name}`];
            }),
          );
          const overflow = scroller.scrollWidth > scroller.clientWidth;
          return {
            small,
            outside,
            crowded,
            overflow,
            icons: icons.length,
            undo: document.querySelectorAll("[data-testid=undo-delete]").length,
          };
        });
        expect(report.small).toEqual([]);
        expect(report.outside).toEqual([]);
        expect(report.crowded).toEqual([]);
        expect(report.overflow).toBe(false);
        expect(report.icons).toBeGreaterThan(0);
        expect(report.undo).toBe(1);
      } finally {
        await page.close();
      }
    },
  );

  /* The confirm's and the replace form's buttons only render after a press,
     which static markup can't make; outline-step.test.tsx checks they carry
     these classes, and this checks the classes reach 44px over size="sm". */
  it.each([
    [390, true],
    [1440, false],
  ] as const)(
    "lifts size=sm and icon-sm buttons to 44px on a phone only (%ipx)",
    async (width, phone) => {
      const markup = renderToStaticMarkup(
        <div>
          <Button size="sm" className={TOUCH_HEIGHT}>
            Keep my edits
          </Button>
          <Button size="icon-sm" className={TOUCH_SQUARE} aria-label="Move">
            x
          </Button>
        </div>,
      );
      const page = await browser.newPage({ viewport: { width, height: 600 } });
      try {
        await page.setContent(
          pageHtml(markup, await appCssFor(markup), "light"),
        );
        const sizes = await page.evaluate(() =>
          [...document.querySelectorAll("button")].map((b) => {
            const r = b.getBoundingClientRect();
            return [r.width, r.height];
          }),
        );
        if (phone) {
          expect(sizes[0][1]).toBe(44);
          expect(sizes[1]).toEqual([44, 44]);
        } else {
          expect(sizes[0][1]).toBe(28);
          expect(sizes[1]).toEqual([28, 28]);
        }
      } finally {
        await page.close();
      }
    },
  );

  /* Side by side, the row jumped to stacked when the pending note came in;
     stacked at every width, it has nothing to jump to. */
  it.each([768, 1280])(
    "stacks the count line over the count control at %ipx",
    async (width) => {
      const markup = dialogMarkup(outline);
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(
          pageHtml(markup, await appCssFor(markup), "dark"),
        );
        const stacked = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-testid=outline-count-row]",
          );
          const [line, control] = row ? [...row.children] : [];
          if (!line || !control) throw new Error("count row not rendered");
          return (
            control.getBoundingClientRect().top >=
            line.getBoundingClientRect().bottom
          );
        });
        expect(stacked).toBe(true);
      } finally {
        await page.close();
      }
    },
  );
});
