import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestDesignModal } from "./request-design-modal";
import type { BrandSummary, CalendarItem } from "./types";

const { refreshMock, replaceMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
  usePathname: () => "/calendar",
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const brand: BrandSummary = {
  id: "brand-1",
  name: "QA Brand",
  primaryColor: null,
  secondaryColor: null,
  logoUrl: null,
};

function makeItem(): CalendarItem {
  return {
    id: "item-1",
    date: new Date("2026-08-28T00:00:00.000Z"),
    time: null,
    platform: "Instagram",
    contentType: "Post",
    title: "Launch flyer",
    brief: "A brief",
    caption: null,
    notes: null,
    designRequired: true,
    designType: "Flyer",
    dimensions: null,
    status: "draft",
    source: "ai",
  };
}

function renderModal(item: CalendarItem) {
  return render(
    <RequestDesignModal
      open
      onOpenChange={vi.fn()}
      item={item}
      brand={brand}
      campaignName="QA Campaign"
    />,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/calendar");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ticket: {
          ticketNumber: 23,
          designType: "Flyer",
          slides: null,
          dueDate: null,
        },
      }),
    }),
  );
});

async function submit() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  await waitFor(() => expect(screen.getByText("DT-00023")).toBeInTheDocument());
}

describe("RequestDesignModal", () => {
  /* The submit refreshes the calendar, which hands this modal a new object for
     the same row. Keying the prefill effect on the object wiped the just-set
     confirmation and showed a blank form instead of the ticket number. */
  it("keeps the confirmation when the calendar refresh re-identifies the item", async () => {
    const { rerender } = renderModal(makeItem());
    await submit();

    rerender(
      <RequestDesignModal
        open
        onOpenChange={vi.fn()}
        item={makeItem()}
        brand={brand}
        campaignName="QA Campaign"
      />,
    );

    expect(screen.getByText("DT-00023")).toBeInTheDocument();
  });

  it("drops ?pick=design once the request exists, keeping the other params", async () => {
    window.history.replaceState(
      {},
      "",
      "/calendar?pick=design&view=agenda&calendarId=cal-1",
    );
    renderModal(makeItem());
    await submit();

    expect(replaceMock).toHaveBeenCalledWith(
      "/calendar?view=agenda&calendarId=cal-1",
      { scroll: false },
    );
    /* The replace re-runs the server component; pairing it with a refresh
       races the two and restores the stale URL. */
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes normally when the user did not arrive from the chooser", async () => {
    renderModal(makeItem());
    await submit();

    expect(replaceMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });

  /* The banner only renders for pick=design. Stripping any other pick value
     would silently eat an unrelated param and skip the refresh on a page that
     was never in pick mode. */
  it("leaves an unrelated pick value alone", async () => {
    window.history.replaceState({}, "", "/calendar?pick=banana&view=agenda");
    renderModal(makeItem());
    await submit();

    expect(replaceMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });
});
