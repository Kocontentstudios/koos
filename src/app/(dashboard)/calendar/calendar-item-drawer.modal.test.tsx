import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Browser, Page } from "playwright";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  appCssFor,
  launchChromium,
  pageHtml,
} from "@/lib/testing/browser-layout";
import { withKoImagery } from "@/lib/testing/ko-imagery";

/* Round 5 (D-A): opened from this drawer, the image dialog is a nested Base
   UI dialog. Base UI drops a nested dialog's backdrop, so the drawer beside
   the dialog stayed bright and live: a click on its "Edit details" unmounted
   the dialog mid-upload or mid-generation, and its Delete stacked a second
   dialog over the first. These tests drive the real drawer and the real
   dialog, then measure the DOM they produce in Chromium, since jsdom has no
   hit-testing and does not honour inert. */

vi.mock("./actions", () => ({
  updateCalendarItemAction: vi.fn(),
  deleteCalendarItemAction: vi.fn(),
  updateCalendarItemStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/analytics/posthog-client", () => ({ captureEvent: vi.fn() }));
/* An upload that is still being prepared: the other state a stray click
   must never wipe. */
vi.mock("@/lib/uploads/normalize-image", async (original) => ({
  ...(await original<typeof import("@/lib/uploads/normalize-image")>()),
  normalizeImageForUpload: () => new Promise(() => {}),
}));

/* A run that starts and never finishes, so the dialog holds its progress
   view: the state a stray click must never wipe. */
vi.mock("@/components/design/use-design-generation", async () => {
  const { useState } = await import("react");
  return {
    useDesignGeneration: () => {
      const [pending, setPending] = useState(false);
      return {
        generate: async () => {
          setPending(true);
          return new Promise(() => {});
        },
        retry: async () => {},
        pending,
        progressLabel: null,
        stage: pending ? "starting" : null,
        progress: null,
        jobStage: null,
        error: null,
        partial: null,
        failedCount: 0,
        failedIds: [],
        generations: [],
        reset: () => setPending(false),
      };
    },
  };
});

import { CalendarItemDrawer } from "./calendar-item-drawer";

function renderDrawer() {
  const onOpenChange = vi.fn();
  render(
    <CalendarItemDrawer
      item={{
        id: "i1",
        date: new Date("2026-09-12T00:00:00Z"),
        time: "10:00 AM",
        platform: "Instagram",
        contentType: "Post",
        title: "Flat white, slow morning",
        brief: "A quiet first coffee",
        caption: "Slow down. #KOOS",
        notes: null,
        designRequired: false,
        designType: null,
        dimensions: null,
        status: "draft",
        source: "manual",
      }}
      brandId="3aac081f-cae5-446c-af3a-eaa2dfc3f916"
      open
      onOpenChange={onOpenChange}
      submitted={false}
      onRequestDesign={vi.fn()}
    />,
    withKoImagery(true),
  );
  return { onOpenChange };
}

function sheet(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-slot=sheet-content]");
  if (!el) throw new Error("drawer not rendered");
  return el;
}

function imageDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot=dialog-content]");
}

function dialogOverlay(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-slot=dialog-overlay]");
  if (!el) throw new Error("the image dialog rendered no overlay");
  return el;
}

async function openImageDialog() {
  await userEvent.click(
    screen.getByRole("button", { name: /generate with ai/i }),
  );
  await screen.findByText(/choose the image for this post/i);
}

async function startGenerating() {
  await openImageDialog();
  await userEvent.click(
    screen.getByRole("button", { name: /let ko create the imagery/i }),
  );
  await waitFor(() =>
    expect(imageDialog()?.querySelector("[role=status]")).not.toBeNull(),
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("the image dialog opened from the calendar drawer", () => {
  it("covers the drawer with its own overlay and makes the drawer inert", async () => {
    renderDrawer();
    expect(sheet().hasAttribute("inert")).toBe(false);
    await openImageDialog();

    const overlay = dialogOverlay();
    expect(overlay.hidden).toBe(false);
    expect(
      sheet().compareDocumentPosition(overlay) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(sheet().hasAttribute("inert")).toBe(true);
  });

  it("gives the drawer back once the dialog closes", async () => {
    renderDrawer();
    await openImageDialog();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(sheet().hasAttribute("inert")).toBe(false));
  });

  it("does not let a click beside it wipe a run in progress", async () => {
    const { onOpenChange } = renderDrawer();
    await startGenerating();
    await userEvent.click(dialogOverlay());
    expect(imageDialog()?.querySelector("[role=status]")).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("does not let a click beside it drop a chosen image", async () => {
    renderDrawer();
    await openImageDialog();
    await userEvent.click(
      screen.getByRole("button", { name: /use a specific image/i }),
    );
    await userEvent.upload(
      screen.getByTestId("design-image-input"),
      new File([new Uint8Array(64)], "cafe.jpg", { type: "image/jpeg" }),
    );
    await screen.findByText(/cafe\.jpg/);
    await userEvent.click(dialogOverlay());
    expect(imageDialog()).not.toBeNull();
    expect(screen.getByText(/cafe\.jpg/)).toBeInTheDocument();
  });

  it("closes on a click beside it when nothing is lost, and leaves the drawer open", async () => {
    const { onOpenChange } = renderDrawer();
    await openImageDialog();
    await userEvent.click(dialogOverlay());
    await waitFor(() => expect(imageDialog()).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(sheet().hasAttribute("inert")).toBe(false);
  });
});

describe("the drawer behind the image dialog, measured in Chromium", () => {
  let browser: Browser;
  let markup: string;

  beforeAll(async () => {
    browser = await launchChromium();
  });
  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    renderDrawer();
    await startGenerating();
    markup = document.body.innerHTML;
  });

  async function load(width: number, height: number): Promise<Page> {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(pageHtml(markup, await appCssFor(markup), "light"));
    return page;
  }

  it.each([
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [390, 844],
  ])("no pointer reaches a drawer control at %ipx x %ipx", async (w, h) => {
    const page = await load(w, h);
    try {
      const reached = await page.evaluate(() => {
        const drawer = document.querySelector("[data-slot=sheet-content]");
        if (!drawer) throw new Error("drawer missing");
        const controls = drawer.querySelectorAll<HTMLElement>(
          "button, a[href], select, input, textarea",
        );
        if (controls.length < 3) throw new Error("drawer controls missing");
        return [...controls].flatMap((el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          if (r.width === 0 || x < 0 || y < 0) return [];
          if (x > innerWidth || y > innerHeight) return [];
          const hit = document.elementFromPoint(x, y);
          return hit && drawer.contains(hit)
            ? [(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()]
            : [];
        });
      });
      expect(reached).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("no focus reaches the drawer, by Tab or by script", async () => {
    const page = await load(1440, 900);
    try {
      const focusable = await page.evaluate(() => {
        const drawer = document.querySelector("[data-slot=sheet-content]");
        if (!drawer) throw new Error("drawer missing");
        const controls = drawer.querySelectorAll<HTMLElement>(
          "button, a[href], select, input, textarea",
        );
        return [...controls].filter((el) => {
          el.focus();
          return drawer.contains(document.activeElement);
        }).length;
      });
      expect(focusable).toBe(0);

      const tabbedInto: string[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const inDrawer = await page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-slot=sheet-content]")
              ?.contains(document.activeElement),
          ),
        );
        if (inDrawer) tabbedInto.push(`press ${i}`);
      }
      expect(tabbedInto).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
