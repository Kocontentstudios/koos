import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowChromeProvider } from "@/components/design/directions/flow-heading";
import {
  type ApprovedOutline,
  FRAME_BOUNDS,
  type PlannedOutline,
  type SequenceKind,
} from "@/lib/design/sequence/contract";
import { BRAND, plannedOutline } from "./fixtures";
import { OutlineStep } from "./outline-step";
import { useOutline } from "./use-outline";

type Answer =
  | Response
  | Promise<Response>
  | (() => Response | Promise<Response>);

let answers: Answer[] = [];
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  const next = answers.shift();
  if (!next) throw new Error("unexpected fetch");
  return typeof next === "function" ? next() : next;
});

function outlineAnswer(outline: PlannedOutline = plannedOutline(5)): Response {
  return Response.json({ outline });
}

function deferred() {
  let resolve: (r: Response) => void = () => {};
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function requestBody(call: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body));
}

function Harness({
  kind = "carousel",
  starting = false,
  onGenerate,
  onBack = () => {},
}: {
  kind?: SequenceKind;
  starting?: boolean;
  onGenerate: (approved: ApprovedOutline) => void;
  onBack?: () => void;
}) {
  const outline = useOutline(kind, { brandId: BRAND, briefId: "brief-1" });
  return (
    <FlowChromeProvider value="static">
      <OutlineStep
        outline={outline}
        starting={starting}
        onBack={onBack}
        onGenerate={onGenerate}
      />
    </FlowChromeProvider>
  );
}

async function ready(
  outline: PlannedOutline = plannedOutline(5),
  props: Partial<React.ComponentProps<typeof Harness>> = {},
) {
  answers.push(outlineAnswer(outline));
  const onGenerate = vi.fn();
  const view = render(<Harness onGenerate={onGenerate} {...props} />);
  await screen.findByRole("list", { name: /^Outline/ });
  return { onGenerate, ...view };
}

const cards = () =>
  within(screen.getByRole("list", { name: /^Outline/ }))
    .getAllByRole("listitem")
    .filter((li) => li.hasAttribute("data-point"));

const generateButton = () =>
  screen.getByRole("button", { name: /^Generate \d+ slides? · \d+ units?$/ });

beforeEach(() => {
  answers = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planning the outline", () => {
  it("asks the outline route once, with the run's context and no count", async () => {
    await ready();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/design/outline");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(requestBody(0)).toEqual({ brandId: BRAND, briefId: "brief-1" });
  });

  it("says it is planning, with skeleton rows, until the points arrive", async () => {
    const pending = deferred();
    answers.push(pending.promise);
    render(<Harness onGenerate={vi.fn()} />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Planning the slides from your brief…");
    expect(
      status.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("list", { name: /^Outline/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Generate/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    pending.resolve(outlineAnswer());
    await screen.findByRole("list", { name: /^Outline/ });
  });

  it("says the outline is empty, not loading, when no points came back", async () => {
    answers.push(
      outlineAnswer({ ...plannedOutline(5), points: [], frameCount: 0 }),
    );
    render(<Harness onGenerate={vi.fn()} />);
    const status = await screen.findByText("KO found nothing to plan");
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    answers.push(outlineAnswer());
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("list", { name: /^Outline/ });
  });

  it("says what went wrong and retries on an error", async () => {
    answers.push(Response.json({ error: "Brief not found" }, { status: 404 }));
    render(<Harness onGenerate={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The outline didn't come through");
    expect(alert).toHaveTextContent("Brief not found");
    answers.push(outlineAnswer());
    await userEvent.click(
      within(alert).getByRole("button", { name: "Try again" }),
    );
    await screen.findByRole("list", { name: /^Outline/ });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says when the rate limit lets the user plan again", async () => {
    answers.push(
      Response.json(
        { error: "Too many requests." },
        { status: 429, headers: { "Retry-After": "120" } },
      ),
    );
    render(<Harness onGenerate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've planned a lot of outlines this hour. Try again in 2 minutes.",
    );
  });

  it("names a lost connection as one", async () => {
    answers.push(() => {
      throw new TypeError("Failed to fetch");
    });
    render(<Harness onGenerate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "KO couldn't be reached. Check your connection and try again.",
    );
  });

  it("treats a 200 without an outline as an error, not an empty outline", async () => {
    answers.push(Response.json({ nope: true }));
    render(<Harness onGenerate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "KO couldn't plan this outline",
    );
  });
});

describe("the points", () => {
  it("shows each point's slide, role, source, title and words", async () => {
    await ready();
    const list = cards();
    expect(list).toHaveLength(5);
    expect(within(list[0]).getByRole("heading")).toHaveTextContent(
      "Slide 1 · Hook",
    );
    expect(within(list[0]).getByRole("heading")).toHaveTextContent(
      "From your brief",
    );
    expect(within(list[3]).getByRole("heading")).toHaveTextContent(
      "From your brand profile",
    );
    expect(within(list[4]).getByRole("heading")).toHaveTextContent(
      "Slide 5 · Action",
    );
    expect(
      within(list[1]).getByRole("textbox", { name: "Title, slide 2" }),
    ).toHaveValue("The fabric");
    expect(
      within(list[1]).getByRole("textbox", { name: "Point, slide 2" }),
    ).toHaveValue("Every piece is woven in Abeokuta from Nigerian cotton.");
  });

  it("uses a presentation's role names", async () => {
    await ready(plannedOutline(4, "presentation"), { kind: "presentation" });
    expect(within(cards()[0]).getByRole("heading")).toHaveTextContent(
      "Slide 1 · Title",
    );
    expect(within(cards()[3]).getByRole("heading")).toHaveTextContent(
      "Slide 4 · Close",
    );
  });

  it("flags weak points with the reason, and says generating is still allowed", async () => {
    await ready();
    expect(
      screen.getByText(/2 may be weak\. You can still generate\./),
    ).toBeInTheDocument();
    expect(cards()[2]).toHaveTextContent(
      "Only says who it is for. Add what the reader gets.",
    );
    expect(cards()[3]).toHaveTextContent("Taken from your brand profile");
    expect(cards()[1].querySelector("[data-weak]")).toBeNull();
    expect(generateButton()).toBeEnabled();
  });

  it("puts the quota units on the generate button", async () => {
    await ready();
    expect(generateButton()).toHaveTextContent("Generate 5 slides · 5 units");
  });

  it("approves the planner's outline untouched", async () => {
    const { onGenerate } = await ready();
    await userEvent.click(generateButton());
    const approved = onGenerate.mock.calls[0]?.[0] as ApprovedOutline;
    expect(approved.kind).toBe("carousel");
    expect(approved.points.map((p) => [p.id, p.role, p.source])).toEqual([
      ["p1", "hook", "brief"],
      ["p2", "body", "brief"],
      ["p3", "body", "brief"],
      ["p4", "body", "profile"],
      ["p5", "cta", "brief"],
    ]);
  });
});

describe("editing", () => {
  it("edits a title in place and sends it as the user's", async () => {
    const { onGenerate } = await ready();
    const title = within(cards()[1]).getByRole("textbox", {
      name: "Title, slide 2",
    });
    await userEvent.clear(title);
    await userEvent.type(title, "Woven here");
    expect(within(cards()[1]).getByRole("heading")).toHaveTextContent(
      "Written by you",
    );
    await userEvent.click(generateButton());
    expect(onGenerate.mock.calls[0]?.[0].points[1]).toMatchObject({
      title: "Woven here",
      source: "user",
    });
  });

  it("holds the limit in the field, not only on submit", async () => {
    await ready();
    const title = within(cards()[1]).getByRole("textbox", {
      name: "Title, slide 2",
    });
    await userEvent.clear(title);
    await userEvent.type(title, "x".repeat(60));
    expect(title).toHaveValue("x".repeat(40));
    expect(cards()[1]).toHaveTextContent("40/40");
  });

  it("keeps a point on one line when Enter is pressed", async () => {
    await ready();
    const point = within(cards()[1]).getByRole("textbox", {
      name: "Point, slide 2",
    });
    await userEvent.clear(point);
    await userEvent.type(point, "One{Enter}line");
    expect(point).toHaveValue("Oneline");
  });

  it("clears a weak flag once the point is rewritten", async () => {
    await ready();
    const point = within(cards()[2]).getByRole("textbox", {
      name: "Point, slide 3",
    });
    await userEvent.clear(point);
    await userEvent.type(point, "Each shirt is cut to your measurements.");
    expect(cards()[2].querySelector("[data-weak]")).toBeNull();
    expect(screen.getByText(/1 may be weak/)).toBeInTheDocument();
  });

  it("replaces a weak point with the user's own in one step", async () => {
    const { onGenerate } = await ready();
    await userEvent.click(
      within(cards()[3]).getByRole("button", {
        name: "Replace with my own point, slide 4",
      }),
    );
    const own = within(cards()[3]).getByRole("textbox", {
      name: "Your point for slide 4",
    });
    expect(own).toHaveFocus();
    await userEvent.type(own, "Free alterations for a year with every suit.");
    await userEvent.click(
      within(cards()[3]).getByRole("button", { name: "Use my point" }),
    );
    expect(cards()[3].querySelector("[data-weak]")).toBeNull();
    const point = within(cards()[3]).getByRole("textbox", {
      name: "Point, slide 4",
    });
    expect(point).toHaveValue("Free alterations for a year with every suit.");
    expect(point).toHaveFocus();
    expect(within(cards()[3]).getByRole("heading")).toHaveTextContent(
      "Written by you",
    );
    await userEvent.click(generateButton());
    expect(onGenerate.mock.calls[0]?.[0].points[3]).toMatchObject({
      point: "Free alterations for a year with every suit.",
      source: "user",
    });
  });

  it("will not take markup as the user's own point", async () => {
    await ready();
    await userEvent.click(
      within(cards()[2]).getByRole("button", {
        name: "Replace with my own point, slide 3",
      }),
    );
    const own = within(cards()[2]).getByRole("textbox", {
      name: "Your point for slide 3",
    });
    await userEvent.type(own, "<script>");
    expect(
      within(cards()[2]).getByRole("button", { name: "Use my point" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(own).toHaveAttribute("aria-invalid", "true");
  });

  it("cancels a replacement and gives focus back", async () => {
    await ready();
    const open = within(cards()[2]).getByRole("button", {
      name: "Replace with my own point, slide 3",
    });
    await userEvent.click(open);
    await userEvent.click(
      within(cards()[2]).getByRole("button", { name: "Cancel" }),
    );
    expect(
      within(cards()[2]).getByRole("button", {
        name: "Replace with my own point, slide 3",
      }),
    ).toHaveFocus();
    expect(cards()[2].querySelector("[data-weak]")).not.toBeNull();
  });
});

describe("deleting and adding", () => {
  it("offers delete on body points only", async () => {
    await ready();
    expect(
      within(cards()[0]).queryByRole("button", { name: /^Delete/ }),
    ).toBeNull();
    expect(
      within(cards()[4]).queryByRole("button", { name: /^Delete/ }),
    ).toBeNull();
    expect(
      within(cards()[2]).getByRole("button", {
        name: "Delete slide 3, Who it's for",
      }),
    ).toBeEnabled();
  });

  it("deletes a point, counts it off the button, and moves focus on", async () => {
    const { onGenerate } = await ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete slide 3, Who it's for" }),
    );
    expect(cards()).toHaveLength(4);
    expect(generateButton()).toHaveTextContent("Generate 4 slides · 4 units");
    expect(
      within(cards()[2]).getByRole("textbox", { name: "Title, slide 3" }),
    ).toHaveFocus();
    expect(
      within(cards()[2]).getByRole("textbox", { name: "Title, slide 3" }),
    ).toHaveValue("Our story");
    expect(
      screen.getByText("Slide 3 deleted. 4 slides in the outline."),
    ).toBeInTheDocument();
    await userEvent.click(generateButton());
    expect(
      onGenerate.mock.calls[0]?.[0].points.map((p: { id: string }) => p.id),
    ).toEqual(["p1", "p2", "p4", "p5"]);
  });

  it("warns which brief facts a deletion leaves unstated", async () => {
    await ready();
    expect(screen.queryByTestId("unstated-facts")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete slide 2, The fabric" }),
    );
    expect(screen.getByTestId("unstated-facts")).toHaveTextContent(
      "No slide says “Abeokuta” any more.",
    );
  });

  it("holds delete at the kind's minimum", async () => {
    await ready(plannedOutline(3, "presentation"), { kind: "presentation" });
    const remove = within(cards()[1]).getByRole("button", {
      name: /^Delete slide 2/,
    });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(remove);
    expect(cards()).toHaveLength(3);
  });

  it("adds a slide before the action and focuses its title", async () => {
    await ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Add a slide before the last" }),
    );
    expect(cards()).toHaveLength(6);
    expect(within(cards()[5]).getByRole("heading")).toHaveTextContent(
      "Slide 6 · Action",
    );
    const title = within(cards()[4]).getByRole("textbox", {
      name: "Title, slide 5",
    });
    expect(title).toHaveFocus();
    expect(within(cards()[4]).getByRole("heading")).toHaveTextContent(
      "Written by you",
    );
    expect(generateButton()).toHaveTextContent("Generate 6 slides · 6 units");
  });

  it("will not generate with a blank point, and says where to look", async () => {
    const { onGenerate } = await ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Add a slide before the last" }),
    );
    await userEvent.click(generateButton());
    expect(onGenerate).not.toHaveBeenCalled();
    const title = within(cards()[4]).getByRole("textbox", {
      name: "Title, slide 5",
    });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(cards()[4]).toHaveTextContent("Give this slide a title.");
    expect(
      screen.getByText("2 fields need fixing before you generate."),
    ).toBeInTheDocument();

    await userEvent.type(title, "Free fitting");
    await userEvent.type(
      within(cards()[4]).getByRole("textbox", { name: "Point, slide 5" }),
      "Every order comes with a free fitting.",
    );
    expect(title).not.toHaveAttribute("aria-invalid");
    await userEvent.click(generateButton());
    expect(onGenerate.mock.calls[0]?.[0].points[4]).toEqual({
      id: "u-1",
      role: "body",
      title: "Free fitting",
      point: "Every order comes with a free fitting.",
      source: "user",
    });
  });

  it("holds add at the kind's maximum and says why", async () => {
    await ready(plannedOutline(FRAME_BOUNDS.carousel.max));
    const add = screen.getByRole("button", {
      name: "Add a slide before the last",
    });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAccessibleDescription(
      "10 slides is the most one carousel can hold.",
    );
  });
});

describe("changing the count", () => {
  it("re-plans at the chosen count and keeps the old outline on screen meanwhile", async () => {
    await ready();
    const pending = deferred();
    answers.push(pending.promise);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Number of slides" }),
      "7",
    );
    await userEvent.click(screen.getByRole("button", { name: "Re-plan" }));
    expect(requestBody(1)).toEqual({
      brandId: BRAND,
      briefId: "brief-1",
      frames: 7,
    });
    expect(
      screen.getByRole("button", { name: /Re-planning 7 slides/ }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByText(/Planning 7 slides\. Your outline stays here/),
    ).toBeInTheDocument();
    expect(cards()).toHaveLength(5);
    expect(generateButton()).toHaveAttribute("aria-disabled", "true");
    pending.resolve(outlineAnswer(plannedOutline(7)));
    await waitFor(() => expect(cards()).toHaveLength(7));
    expect(generateButton()).toHaveTextContent("Generate 7 slides · 7 units");
    expect(generateButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("asks before a re-plan replaces the user's edits", async () => {
    await ready();
    await userEvent.type(
      within(cards()[1]).getByRole("textbox", { name: "Title, slide 2" }),
      "!",
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Number of slides" }),
      "4",
    );
    await userEvent.click(screen.getByRole("button", { name: "Re-plan" }));
    expect(screen.getByText("Re-plan as 4 slides?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep my edits" })).toHaveFocus();
    await userEvent.click(
      screen.getByRole("button", { name: "Keep my edits" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      within(cards()[1]).getByRole("textbox", { name: "Title, slide 2" }),
    ).toHaveValue("The fabric!");

    answers.push(outlineAnswer(plannedOutline(4)));
    await userEvent.click(screen.getByRole("button", { name: "Re-plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Re-plan" }));
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(requestBody(1).frames).toBe(4);
  });

  it("keeps the outline when a re-plan fails, and says so", async () => {
    await ready();
    answers.push(
      Response.json({ error: "Planner unavailable." }, { status: 503 }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Re-plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Planner unavailable. Your outline is unchanged.",
    );
    expect(cards()).toHaveLength(5);
    expect(generateButton()).toBeEnabled();
  });
});

describe("the hand-off", () => {
  it("shows the generate wait on the button while the run is being started", async () => {
    answers.push(outlineAnswer());
    render(<Harness onGenerate={vi.fn()} starting />);
    const button = await screen.findByRole("button", { name: "Starting…" });
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("goes back without generating", async () => {
    const onBack = vi.fn();
    const { onGenerate } = await ready(plannedOutline(5), { onBack });
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();
  });
});
