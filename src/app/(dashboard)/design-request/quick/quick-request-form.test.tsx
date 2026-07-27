import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pollJob from "@/lib/generation/poll-job";
import {
  QuickRequestForm,
  type QuickRequestFormHandle,
} from "./quick-request-form";

vi.mock("./actions", () => ({
  ensureQuickRequestBrand: vi.fn(async () => ({ ok: true, brandId: "b1" })),
}));

function renderForm(ref?: RefObject<QuickRequestFormHandle | null>) {
  return render(
    <QuickRequestForm
      ref={ref}
      defaultBusinessName="Ada Bakes"
      defaultDeliveryEmail="hello@adabakes.com"
    />,
  );
}

describe("QuickRequestForm", () => {
  it("prefills the business name and delivery email", () => {
    renderForm();
    expect(screen.getByLabelText(/business name/i)).toHaveValue("Ada Bakes");
    expect(screen.getByLabelText(/delivery email/i)).toHaveValue(
      "hello@adabakes.com",
    );
  });

  it("shows a validation error when the description is too short", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/describe/i), {
      target: { value: "logo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText(/at least 20 characters/i)).toBeInTheDocument();
  });

  it("hides the slides field for non-carousel design types", () => {
    renderForm();
    expect(screen.queryByLabelText(/slides/i)).not.toBeInTheDocument();
  });

  it("shows the slides field once a carousel type is selected", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/what do you need/i), {
      target: { value: "Instagram Carousel (1080x1350 per slide)" },
    });
    expect(screen.getByLabelText(/slides/i)).toBeInTheDocument();
  });
});

const VALID_DESCRIPTION =
  "A launch announcement for our new sourdough range, warm and inviting.";

function fillValid() {
  fireEvent.change(screen.getByLabelText(/describe/i), {
    target: { value: VALID_DESCRIPTION },
  });
}

describe("QuickRequestForm generation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ jobId: "j1" }), { status: 202 }),
      ),
    );
  });

  it("shows the generated brief for review", async () => {
    vi.spyOn(pollJob, "pollGenerationJob").mockResolvedValue({
      brief: {
        title: "Sourdough Launch",
        designType: "Instagram Post (1080x1350)",
        briefMarkdown: "**Objective**\nAnnounce the range.",
      },
      briefId: null,
    });

    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByText(/announce the range/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /submit request/i }),
    ).toBeInTheDocument();
  });

  it("falls back to the raw description when generation fails", async () => {
    vi.spyOn(pollJob, "pollGenerationJob").mockRejectedValue(
      new Error("The AI returned an unusable response. Please try again."),
    );

    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByText(/new sourdough range/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /submit request/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/couldn't polish/i)).toBeInTheDocument();
  });

  it("threads a reference image attached via the imperative handle into the generation request", async () => {
    vi.spyOn(pollJob, "pollGenerationJob").mockResolvedValue({
      brief: {
        title: "Sourdough Launch",
        designType: "Instagram Post (1080x1350)",
        briefMarkdown: "**Objective**\nAnnounce the range.",
      },
      briefId: null,
    });
    const ref = createRef<QuickRequestFormHandle>();

    renderForm(ref);
    act(() =>
      ref.current?.setReferenceImageUrl("https://example.com/generated.png"),
    );
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByText(/announce the range/i)).toBeInTheDocument(),
    );

    expect(screen.getByText(/reference image attached/i)).toBeInTheDocument();
    const generateCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => url === "/api/design-brief/generate");
    const body = JSON.parse(generateCall?.[1]?.body as string);
    expect(body.conversation).toContain(
      "Reference image: https://example.com/generated.png",
    );
  });
});
