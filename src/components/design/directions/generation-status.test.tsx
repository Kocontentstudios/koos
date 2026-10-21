import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlowChromeProvider } from "./flow-heading";
import { GenerationError, GenerationProgress } from "./generation-status";

function renderStatic(ui: React.ReactElement) {
  return render(<FlowChromeProvider value="static">{ui}</FlowChromeProvider>);
}

describe("GenerationProgress", () => {
  it.each([
    [null, null, "Reading your brief and Brand Brain", 1],
    [
      "running",
      { done: 0, total: 3 },
      "Art-directing two different directions",
      2,
    ],
    [
      "running",
      { done: 2, total: 3 },
      "Laying out your image in both designs",
      3,
    ],
    ["fetching", { done: 3, total: 3 }, "Getting your designs ready", 4],
  ] as const)(
    "at stage %s announces the matching step",
    (stage, progress, text, step) => {
      renderStatic(
        <GenerationProgress
          source="upload"
          stage={stage}
          progress={progress}
          label="Rendering designs…"
        />,
      );
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(text);
      expect(status).toHaveTextContent(`step ${step} of 4`);
      /* The worker's own words stay visible: the steps are a summary, not a
         replacement for what is actually happening. */
      expect(status).toHaveTextContent("Rendering designs…");
      expect(status).not.toHaveAttribute("aria-busy");
    },
  );

  it("names the KO imagery step for the KO path", () => {
    renderStatic(
      <GenerationProgress
        source="ko"
        stage="running"
        progress={{ done: 1, total: 3 }}
        label={null}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Creating imagery/);
  });
});

function errorView(unusableImage: boolean) {
  const handlers = {
    onRetry: vi.fn(),
    onChooseAnotherImage: vi.fn(),
    onUseKoImagery: vi.fn(),
    onChangeImage: vi.fn(),
  };
  renderStatic(
    <GenerationError
      message={
        unusableImage
          ? "This image can't be used. Choose a PNG or JPG."
          : "Design generation failed. Please try again."
      }
      unusableImage={unusableImage}
      {...handlers}
    />,
  );
  return handlers;
}

describe("GenerationError", () => {
  it("gives an unusable image two ways out, neither of them a retry", async () => {
    const handlers = errorView(true);
    expect(
      screen.getByRole("heading", { name: "This image can't be used" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PNG or JPG");
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Choose another image" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    expect(handlers.onChooseAnotherImage).toHaveBeenCalled();
    expect(handlers.onUseKoImagery).toHaveBeenCalled();
  });

  it("offers a retry for any other failure", async () => {
    const handlers = errorView(false);
    expect(
      screen.getByRole("heading", { name: "We couldn't finish your designs" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await userEvent.click(screen.getByRole("button", { name: "Change image" }));
    expect(handlers.onRetry).toHaveBeenCalled();
    expect(handlers.onChangeImage).toHaveBeenCalled();
  });
});
