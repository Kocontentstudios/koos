import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { StepCompetitors } from "./step-competitors";
import { StepDirection } from "./step-direction";
import { StepPersonality } from "./step-personality";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function mockSuggestFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ suggestion: "A crisp line." }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SuggestButton wiring across steps", () => {
  it("StepDirection wires targetAudience and offer", async () => {
    const fetchMock = mockSuggestFetch();
    const onChange = vi.fn();
    render(<StepDirection state={{ ...DEFAULT_STATE }} onChange={onChange} />);

    const buttons = screen.getAllByRole("button", { name: /suggest with ai/i });
    expect(buttons).toHaveLength(2);

    await userEvent.click(buttons[0]);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        targetAudience: "A crisp line.",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).field).toBe(
      "targetAudience",
    );

    await userEvent.click(buttons[1]);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ offer: "A crisp line." }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).field).toBe(
      "offer",
    );
  });

  it("StepPersonality wires values", async () => {
    mockSuggestFetch();
    const onChange = vi.fn();
    render(
      <StepPersonality state={{ ...DEFAULT_STATE }} onChange={onChange} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /suggest with ai/i }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ values: "A crisp line." }),
    );
  });

  it("StepCompetitors wires differentiators", async () => {
    mockSuggestFetch();
    const onChange = vi.fn();
    render(
      <StepCompetitors state={{ ...DEFAULT_STATE }} onChange={onChange} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /suggest with ai/i }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        differentiators: "A crisp line.",
      }),
    );
  });
});
