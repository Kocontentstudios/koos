// @vitest-environment node
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  };
}

const VIEWS: [string, DirectionsView][] = [
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
        "button, a[href], [tabindex='0']",
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

describe.each(VIEWS)("directions dialog, %s", (_name, view) => {
  it.each(WIDTHS)(
    "keeps every focus outline inside the scroll box at %ipx",
    async (width) => {
      expect(await clippedOutlines(view, width)).toEqual([]);
    },
  );
});
