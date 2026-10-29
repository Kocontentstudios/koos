import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignImageError } from "@/lib/uploads/design-image";
import { FlowChromeProvider } from "./flow-heading";
import type { ImageSource } from "./flow-logic";
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

  /* Prototype 07: one title, one line. Round 2 stacked "Creating two
     directions" / "Writing two directions from your brief" / "Writing the
     directions…", three ways of saying the same thing. */
  it("shows one title and one status line", () => {
    const status = progress({ jobStage: "brief" });
    expect(
      screen.getByRole("heading", { name: "Creating two directions" }),
    ).toBeInTheDocument();
    expect(status.tagName).toBe("P");
    expect(status.querySelectorAll("p")).toHaveLength(0);
    expect(status).toHaveTextContent(
      /^Writing two directions from your brief, step 1 of 4$/,
    );
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
    });
    expect(status).toHaveTextContent("step 3 of 3");
    expect(status).not.toHaveTextContent("2 of 2 done");
  });
});

function errorView(
  message: string,
  unusableImage: boolean,
  source: ImageSource = "upload",
  koImagery = true,
) {
  const handlers = {
    onRetry: vi.fn(),
    onChooseAnotherImage: vi.fn(),
    onUseKoImagery: vi.fn(),
    onNoImage: vi.fn(),
    onChangeImage: vi.fn(),
  };
  renderStatic(
    <GenerationError
      message={message}
      source={source}
      unusableImage={unusableImage}
      koImagery={koImagery}
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

  /* The real server message is "This image can't be used: <reason>. Choose
     another image." The heading says the first half and the button says the
     last sentence; each is read once. Round 2 said "Choose another image"
     three times on this screen. */
  it("says each part of the server's real message once", () => {
    errorView(new DesignImageError("unreadable").message, true);
    const alert = screen.getByRole("alert");
    expect(
      screen.getByText("It could not be read and may be damaged."),
    ).toBeInTheDocument();
    expect(alert.textContent).not.toMatch(/:\s*it could not/i);
    expect(alert.textContent?.match(/can't be used/g)).toHaveLength(1);
    expect(alert.textContent?.match(/choose another image/gi)).toHaveLength(1);
    expect(alert.textContent).not.toMatch(/let KO create the imagery instead/);
  });

  /* FEATURE_KO_IMAGERY off (Oluwaseyi's ruling, 2026-10-27): the second way
     out of an unusable image is a text-led design, never KO imagery. */
  it("offers a design without an image instead of KO imagery when the flag is off", async () => {
    const handlers = errorView(
      new DesignImageError("not_png_or_jpeg").message,
      true,
      "upload",
      false,
    );
    expect(
      screen.queryByRole("button", { name: /let ko create the imagery/i }),
    ).toBeNull();
    expect(screen.getByRole("alert")).not.toHaveTextContent(/KO/);
    await userEvent.click(
      screen.getByRole("button", { name: "Design without an image" }),
    );
    expect(handlers.onNoImage).toHaveBeenCalledOnce();
    expect(handlers.onUseKoImagery).not.toHaveBeenCalled();
  });

  it("keeps a remedy the buttons do not give", () => {
    errorView(new DesignImageError("too_large").message, true);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a smaller image.",
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

  /* No image was chosen on a KO run, so there is none to change. */
  it("offers to start over, not change an image, after a KO-imagery run", async () => {
    const handlers = errorView(
      "Design generation failed. Please try again.",
      false,
      "ko",
    );
    expect(screen.queryByRole("button", { name: /change image/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(handlers.onChangeImage).toHaveBeenCalled();
  });
});
