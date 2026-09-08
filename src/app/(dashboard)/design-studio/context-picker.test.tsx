import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextOption } from "@/lib/design/context-search";
import { ContextPicker, toAttachmentRefs } from "./context-picker";

const OPTIONS: ContextOption[] = [
  { type: "brief", id: "b1", label: "Launch flyer brief", hint: "Flyer" },
  {
    type: "calendar_item",
    id: "c1",
    label: "Friday teaser post",
    hint: "Instagram · 2026-09-01",
  },
  { type: "strategy", id: "s1", label: "Q4 push", hint: "active" },
];

function stubOptions(options = OPTIONS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ options }) })),
  );
}

/** Opens the picker and waits for its list to load. */
async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Give context" }));
  await waitFor(() =>
    expect(screen.queryByText("Loading your content…")).not.toBeInTheDocument(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContextPicker", () => {
  it("labels the trigger so the tooltip text is reachable", () => {
    stubOptions();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    expect(
      screen.getByRole("combobox", { name: "Give context" }),
    ).toBeInTheDocument();
  });

  /* Most sessions never attach anything, and the route runs five queries. */
  it("does not fetch anything until it is opened", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads this brand's content when opened", async () => {
    stubOptions();
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await openPicker(user);

    expect(fetch).toHaveBeenCalledWith("/api/design/context?brandId=brand-1");
    expect(screen.getByText("Launch flyer brief")).toBeInTheDocument();
  });

  it("groups the options by kind", async () => {
    stubOptions();
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await openPicker(user);

    expect(screen.getByText("Design briefs")).toBeInTheDocument();
    expect(screen.getByText("Content calendar")).toBeInTheDocument();
    expect(screen.getByText("Campaign strategies")).toBeInTheDocument();
  });

  it("adds a selection without replacing what is already attached", async () => {
    stubOptions();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextPicker
        brandId="brand-1"
        selected={[OPTIONS[0]]}
        onChange={onChange}
      />,
    );
    await openPicker(user);
    await user.click(screen.getByText("Friday teaser post"));

    expect(onChange).toHaveBeenCalledWith([OPTIONS[0], OPTIONS[1]]);
  });

  it("shows each attachment as a chip", () => {
    stubOptions();
    render(
      <ContextPicker
        brandId="brand-1"
        selected={[OPTIONS[0], OPTIONS[1]]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Launch flyer brief")).toBeInTheDocument();
    expect(screen.getByText("Friday teaser post")).toBeInTheDocument();
  });

  it("removes an attachment from its chip", async () => {
    stubOptions();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextPicker
        brandId="brand-1"
        selected={[OPTIONS[0], OPTIONS[1]]}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Remove Launch flyer brief" }),
    );
    expect(onChange).toHaveBeenCalledWith([OPTIONS[1]]);
  });

  it("reports a load failure instead of showing an empty picker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await user.click(screen.getByRole("combobox", { name: "Give context" }));

    expect(
      await screen.findByText("Could not load your content."),
    ).toBeInTheDocument();
  });

  it("cannot be opened while a generation is running", () => {
    stubOptions();
    render(
      <ContextPicker
        brandId="brand-1"
        selected={[]}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Give context" }),
    ).toBeDisabled();
  });
});

describe("toAttachmentRefs", () => {
  it("keeps only what the generate request needs", () => {
    expect(toAttachmentRefs(OPTIONS)).toEqual([
      { type: "brief", id: "b1" },
      { type: "calendar_item", id: "c1" },
      { type: "strategy", id: "s1" },
    ]);
  });

  it("is empty when nothing is attached", () => {
    expect(toAttachmentRefs([])).toEqual([]);
  });
});

/* ── KOOS-BUG-017 ──────────────────────────────────────────────────────── */

const briefs = (n: number): ContextOption[] =>
  Array.from({ length: n }, (_, i) => ({
    type: "brief" as const,
    id: `b${i}`,
    label: `Brief ${i}`,
    hint: null,
  }));

const calendarItems = (n: number, calId = "cal-1"): ContextOption[] =>
  Array.from({ length: n }, (_, i) => ({
    type: "calendar_item" as const,
    id: `${calId}-${i}`,
    label: `Item ${calId} ${i}`,
    hint: null,
    groupId: calId,
    groupLabel: `Campaign ${calId}`,
  }));

/* Queried through the DOM rather than by role name, for two reasons the
   accessible tree makes unavoidable: a group's name concatenates its heading
   and its count ("Design briefs8 of 12"), and the expander's name lives on
   aria-label because its only child is an aria-hidden chevron — so it has no
   text content to filter on. */
const groupStartingWith = (heading: string): HTMLElement => {
  const group = [...document.querySelectorAll('[role="group"]')].find((g) => {
    const id = g.getAttribute("aria-labelledby");
    return id && document.getElementById(id)?.textContent?.startsWith(heading);
  });
  if (!group) throw new Error(`no group headed "${heading}"`);
  return group as HTMLElement;
};

/** Item rows in a group. The expander is an option too; it carries aria-label. */
const itemsIn = (heading: string) =>
  [...groupStartingWith(heading).querySelectorAll('[role="option"]')].filter(
    (o) => !o.hasAttribute("aria-label"),
  );

const expander = (name: RegExp) => screen.getByRole("option", { name });

describe("expanding a capped group", () => {
  /* The regression. A plain <button> is not registered in the combobox's
     composite list, so arrow keys skip it entirely and Enter lands on the
     first brief — attaching it instead of expanding. */
  it("is reachable with the keyboard, and expands rather than attaching", async () => {
    stubOptions(briefs(12));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={onChange} />,
    );
    await openPicker(user);

    /* The highlight is React state and Enter reads it, so wait for the move
       to land before pressing. aria-activedescendant is how this combobox
       tracks it — focus never leaves the input. */
    const input = screen.getByRole("combobox", {
      name: "Search context to attach",
    });
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant"));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(itemsIn("Design briefs")).toHaveLength(12));
    expect(onChange).not.toHaveBeenCalled();
  });

  /* Today's control is one-way: `new Set(prev).add(key)` with no delete. */
  it("collapses again when activated a second time", async () => {
    stubOptions(briefs(12));
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await openPicker(user);

    await user.click(expander(/^Show all 12 in Design briefs$/));
    expect(itemsIn("Design briefs")).toHaveLength(12);

    await user.click(expander(/^Show fewer in Design briefs$/));
    expect(itemsIn("Design briefs")).toHaveLength(8);
  });

  /* aria-expanded is invalid on role="option", so the state has to live in the
     accessible name — that is what tells a screen reader user this row is a
     disclosure and not a brief. */
  it("names itself as a disclosure, and says which way it goes", async () => {
    stubOptions(briefs(12));
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await openPicker(user);

    expect(expander(/^Show all 12 in Design briefs$/)).toBeInTheDocument();
    await user.click(expander(/^Show all 12 in Design briefs$/));
    expect(expander(/^Show fewer in Design briefs$/)).toBeInTheDocument();
  });

  it("offers no expander for a group that already fits", async () => {
    stubOptions(briefs(3));
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await openPicker(user);

    expect(screen.queryByRole("option", { name: /^Show all/ })).toBeNull();
    expect(itemsIn("Design briefs")).toHaveLength(3);
  });

  it("expands only the group that was activated", async () => {
    stubOptions([...briefs(12), ...calendarItems(12)]);
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await openPicker(user);

    await user.click(expander(/^Show all 12 in Design briefs$/));
    expect(itemsIn("Design briefs")).toHaveLength(12);
    expect(itemsIn("Content calendar · Campaign cal-1")).toHaveLength(8);
  });

  /* base-ui's own click handler runs commitSelection, which in `multiple` mode
     clears the search input whenever a selection lands while filtering. The
     expander must suppress it, or expanding wipes the user's query. */
  it("keeps the query and attaches nothing", async () => {
    stubOptions(briefs(12));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={onChange} />,
    );
    await openPicker(user);

    const input = screen.getByRole("combobox", {
      name: "Search context to attach",
    });
    await user.type(input, "Brief");
    await user.click(expander(/^Show all \d+ in Design briefs$/));

    expect(input).toHaveValue("Brief");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("omits nothing from a very long group", async () => {
    stubOptions(calendarItems(163));
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await openPicker(user);

    await user.click(expander(/^Show all 163 in /));
    expect(itemsIn("Content calendar · Campaign cal-1")).toHaveLength(163);
    expect(screen.getByText("Item cal-1 162")).toBeInTheDocument();
  });

  /* The cap used to be stated by the "Show N more" text. Removing that text
     must not remove the honesty with it. */
  it("says how many of the total are showing while capped", async () => {
    stubOptions(briefs(12));
    const user = userEvent.setup();
    render(
      <ContextPicker brandId="brand-1" selected={[]} onChange={vi.fn()} />,
    );
    await openPicker(user);

    expect(screen.getByText("8 of 12")).toBeInTheDocument();
    await user.click(expander(/^Show all 12 in Design briefs$/));
    expect(screen.queryByText("8 of 12")).toBeNull();
  });
});
