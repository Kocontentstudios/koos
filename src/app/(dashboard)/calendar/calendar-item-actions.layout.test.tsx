// @vitest-environment node

import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenerateDesignButton } from "@/components/design/generate-design-button";
import { SHEET_CONTENT_CLASS } from "@/components/ui/sheet";
import {
  appCssFor,
  launchChromium,
  pageHtml,
} from "@/lib/testing/browser-layout";
import { cn } from "@/lib/utils";
import {
  CALENDAR_DRAWER_CLASS,
  CalendarItemActions,
} from "./calendar-item-actions";

/* Round 4 shipped a nowrap footer of four buttons: at 390px "Generate with
   AI", the feature's only calendar entry, sat off-screen and the whole sheet
   panned sideways (scrollWidth 504 in a 292px sheet). jsdom has no layout, so
   this measures the real sheet classes in Chromium. */

const WIDTHS = [320, 390, 768, 1280, 1440];

function sheetMarkup(submitted: boolean): string {
  return renderToStaticMarkup(
    <div
      data-side="right"
      data-slot="sheet-content"
      className={cn(SHEET_CONTENT_CLASS, CALENDAR_DRAWER_CLASS)}
    >
      <div className="h-[420px] shrink-0" />
      <CalendarItemActions
        submitted={submitted}
        onDelete={() => {}}
        onClose={() => {}}
        onRequestDesign={() => {}}
        generate={
          <GenerateDesignButton
            brandId="b1"
            entry="calendar"
            calendarItemId="i1"
            label="Generate with AI"
            size="lg"
            className="w-full"
          />
        }
      />
    </div>,
  );
}

interface Box {
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  clipsText: boolean;
}

interface Measured {
  pageScroll: number;
  viewport: number;
  sheetScroll: number;
  sheetClient: number;
  footer: { left: number; right: number };
  buttons: Box[];
}

let browser: Browser;

beforeAll(async () => {
  browser = await launchChromium();
});

afterAll(async () => {
  await browser?.close();
});

async function measure(submitted: boolean, width: number): Promise<Measured> {
  const markup = sheetMarkup(submitted);
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await page.setContent(pageHtml(markup, await appCssFor(markup), "dark"));
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => {
      const sheet = document.querySelector<HTMLElement>(
        "[data-slot=sheet-content]",
      );
      const footer = document.querySelector<HTMLElement>(
        "[data-testid=calendar-item-actions]",
      );
      if (!sheet || !footer) throw new Error("sheet not rendered");
      const style = getComputedStyle(footer);
      const box = footer.getBoundingClientRect();
      return {
        pageScroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        sheetScroll: sheet.scrollWidth,
        sheetClient: sheet.clientWidth,
        footer: {
          left: box.left + Number.parseFloat(style.paddingLeft),
          right: box.right - Number.parseFloat(style.paddingRight),
        },
        buttons: [...footer.querySelectorAll("button")].map((b) => {
          const r = b.getBoundingClientRect();
          return {
            name: (b.textContent ?? "").trim(),
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            clipsText: b.scrollWidth > b.clientWidth,
          };
        }),
      };
    });
  } finally {
    await page.close();
  }
}

describe.each([false, true])(
  "calendar drawer actions (submitted: %s)",
  (submitted) => {
    it.each(WIDTHS)(
      "fit the sheet at %ipx with no sideways scroll",
      async (width) => {
        const m = await measure(submitted, width);
        expect(m.pageScroll).toBeLessThanOrEqual(m.viewport);
        expect(m.sheetScroll).toBeLessThanOrEqual(m.sheetClient);
        for (const b of m.buttons) {
          expect(b.left, b.name).toBeGreaterThanOrEqual(m.footer.left - 0.5);
          expect(b.right, b.name).toBeLessThanOrEqual(m.footer.right + 0.5);
          expect(b.clipsText, `${b.name} clips its label`).toBe(false);
        }
      },
    );
  },
);

describe("Generate with AI", () => {
  it.each(WIDTHS)("has its own full-width row at %ipx", async (width) => {
    const m = await measure(false, width);
    const generate = m.buttons.find((b) => b.name === "Generate with AI");
    expect(generate).toBeDefined();
    if (!generate) return;
    expect(generate.left).toBeCloseTo(m.footer.left, 0);
    expect(generate.right).toBeCloseTo(m.footer.right, 0);
    for (const other of m.buttons.filter((b) => b !== generate)) {
      expect(generate.top, other.name).toBeGreaterThanOrEqual(other.bottom);
    }
  });
});
