import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignImageError } from "@/lib/uploads/design-image";
import { FlowChromeProvider } from "./flow-heading";
import {
  GenerationError,
  GenerationProgress,
  type GenerationProgressProps,
} from "./generation-status";

function renderStatic(ui: React.ReactElement) {
  return render(<FlowChromeProvider value="static">{ui}</FlowChromeProvider>);
}

function progress(props: Partial<GenerationProgressProps>) {
  renderStatic(
    <GenerationProgress
      source="ko"
      stage="running"
      jobStage={null}
      progress={null}
      label={null}
      {...props}
    />,
  );
  return screen.getByRole("status");
}

/* The visual steps are aria-hidden; the status text carries the same step. */
const stepLabels = () =>
  within(screen.getByRole("list", { hidden: true }))
    .getAllByRole("listitem", { hidden: true })
    .map((li) => li.textContent?.replace(/^\d/, ""));

describe("GenerationProgress", () => {
  it.each([
    [null, "Writing two directions from your brief", 1],
    ["brief", "Writing two directions from your brief", 1],
    ["imagery", "Creating imagery for each direction", 2],
    ["render", "Laying out both designs", 3],
    ["checks", "Checking both designs against your brand", 4],
  ] as const)(
    "KO path: job stage %s announces the matching step",
    (jobStage, text, step) => {
      const status = progress({ jobStage });
      expect(status).toHaveTextContent(text);
      expect(status).toHaveTextContent(`step ${step} of 4`);
      expect(status).not.toHaveAttribute("aria-busy");
    },
  );

  it.each([
    ["brief", "Writing two directions from your brief", 1],
    ["render", "Laying out your image in both designs", 2],
    ["checks", "Checking both designs against your brand", 3],
  ] as const)(
    "upload path: job stage %s announces step %s of 3",
    (jobStage, text, step) => {
      const status = progress({ source: "upload", jobStage });
      expect(status).toHaveTextContent(text);
      expect(status).toHaveTextContent(`step ${step} of 3`);
    },
  );

  /* The upload path makes no imagery, so it must not list a step for it. */
  it("lists no imagery step on the upload path", () => {
    progress({ source: "upload", jobStage: "render" });
    expect(stepLabels()).toEqual(["Brief", "Layout", "Checks"]);
  });

  it("lists all four steps on the KO path", () => {
    progress({ jobStage: "brief" });
    expect(stepLabels()).toEqual(["Brief", "Imagery", "Layout", "Checks"]);
  });

  /* The label is human text and free to change: the steps never read it. */
  it("ignores the label when choosing the step", () => {
    const status = progress({
      jobStage: "brief",
      label: "Rendering imagery and running checks…",
    });
    expect(status).toHaveTextContent("step 1 of 4");
    /* It stays visible: the steps summarise, they do not replace it. */
    expect(status).toHaveTextContent("Rendering imagery and running checks…");
  });

  it("counts rendered designs during the render stage", () => {
    const status = progress({
      jobStage: "render",
      progress: { done: 1, total: 2 },
    });
    expect(status).toHaveTextContent("Laying out both designs · 1 of 2 done");
  });

  it("is on the last step while the finished designs are read back", () => {
    const status = progress({
      source: "upload",
      stage: "fetching",
      jobStage: "render",
      progress: { done: 2, total: 2 },
      label: "Getting your designs ready…",
    });
    expect(status).toHaveTextContent("step 3 of 3");
    expect(status).not.toHaveTextContent("2 of 2 done");
  });
});

function errorView(message: string, unusableImage: boolean) {
  const handlers = {
    onRetry: vi.fn(),
    onChooseAnotherImage: vi.fn(),
    onUseKoImagery: vi.fn(),
    onChangeImage: vi.fn(),
  };
  renderStatic(
    <GenerationError
      message={message}
      unusableImage={unusableImage}
      {...handlers}
    />,
  );
  return handlers;
}

describe("GenerationError", () => {
  it("gives an unusable image two ways out, neither of them a retry", async () => {
    const handlers = errorView(
      new DesignImageError("not_png_or_jpeg").message,
      true,
    );
    expect(
      screen.getByRole("heading", { name: "This image can't be used" }),
    ).toBeInTheDocument();
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

  /* The real server message is "This image can't be used: <reason>". The
     heading already says the first half; the colon must not dangle. */
  it("shows only the reason from the server's real message", () => {
    errorView(new DesignImageError("unreadable").message, true);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "It could not be read and may be damaged. Choose another image.",
    );
    expect(alert.textContent).not.toMatch(/:\s*it could not/i);
    expect(within(alert).getAllByText(/This image can't be used/)).toHaveLength(
      1,
    );
  });

  it("offers a retry for any other failure", async () => {
    const handlers = errorView(
      "Design generation failed. Please try again.",
      false,
    );
    expect(
      screen.getByRole("heading", { name: "We couldn't finish your designs" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await userEvent.click(screen.getByRole("button", { name: "Change image" }));
    expect(handlers.onRetry).toHaveBeenCalled();
    expect(handlers.onChangeImage).toHaveBeenCalled();
  });
});
