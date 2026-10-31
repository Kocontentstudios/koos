// @vitest-environment node
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plannedOutline } from "@/components/design/sequence/fixtures";
import { draftFrom } from "@/components/design/sequence/outline-model";
import type { OutlineController } from "@/components/design/sequence/use-outline";
import { DIALOG_CONTENT_CLASS } from "@/components/ui/dialog";
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
  reset: noop,
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

function dialogMarkup(view: DirectionsView): string {
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

  /* The dialog's close button sits over the scroll box, so a row that can
     reach the top of the view keeps the same right gutter the heading has. */
  it.each([390, 768, 1440])(
    "keeps the count row clear of the close button at %ipx",
    async (width) => {
      const markup = dialogMarkup(outline);
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(
          pageHtml(markup, await appCssFor(markup), "dark"),
        );
        const gutters = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-testid=outline-count-row]",
          );
          const heading = document
            .querySelector("h2")
            ?.closest<HTMLElement>("div");
          if (!row || !heading) throw new Error("outline not rendered");
          return {
            row: getComputedStyle(row).paddingRight,
            heading: getComputedStyle(heading).paddingRight,
          };
        });
        expect(Number.parseFloat(gutters.row)).toBeGreaterThanOrEqual(32);
        expect(gutters.row).toBe(gutters.heading);
      } finally {
        await page.close();
      }
    },
  );

  /* O3-ui round 3 added move up and down beside delete; three icon buttons
     must stay inside the card and clear of its heading on a phone. */
  it.each([320, 390])(
    "keeps each card's move and delete buttons inside the card at %ipx",
    async (width) => {
      const markup = dialogMarkup(outline);
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(
          pageHtml(markup, await appCssFor(markup), "light"),
        );
        await page.evaluate(() => document.fonts.ready);
        const problems = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("li[data-point]")].flatMap(
            (card) => {
              const box = card.getBoundingClientRect();
              const heading = card.querySelector("h3")?.getBoundingClientRect();
              const buttons = [
                ...card.querySelectorAll<HTMLElement>(
                  "button[aria-label^='Move'], button[aria-label^='Delete']",
                ),
              ].map((b) => b.getBoundingClientRect());
              return buttons.flatMap((b, i) => {
                const out =
                  b.left < box.left || b.right > box.right
                    ? [`${card.dataset.point} button ${i} outside the card`]
                    : [];
                const overlaps =
                  heading &&
                  b.left < heading.right &&
                  b.right > heading.left &&
                  b.top < heading.bottom &&
                  b.bottom > heading.top
                    ? [`${card.dataset.point} button ${i} over the heading`]
                    : [];
                return [...out, ...overlaps];
              });
            },
          ),
        );
        expect(problems).toEqual([]);
        expect(
          await page.locator("button[aria-label^='Move']").count(),
        ).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    },
  );
});
