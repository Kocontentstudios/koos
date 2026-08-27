import { render, screen, waitFor } from "@testing-library/react";
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
