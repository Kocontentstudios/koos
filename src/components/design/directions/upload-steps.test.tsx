import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImageNotUsableError } from "@/lib/uploads/normalize-image";
import { ImageChoice } from "./image-choice";
import { ImageDropzone } from "./image-dropzone";
import { ImagePreview } from "./image-preview";
import type { DesignImageUpload, PickedImage } from "./use-design-image-upload";

const png = () => new File(["x"], "cake.png", { type: "image/png" });

describe("ImageChoice", () => {
  it("offers both sources as buttons", async () => {
    const onUseOwnImage = vi.fn();
    const onLetKoCreate = vi.fn();
    render(
      <ImageChoice
        onUseOwnImage={onUseOwnImage}
        onLetKoCreate={onLetKoCreate}
        onFileDropped={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /use a specific image/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    expect(onUseOwnImage).toHaveBeenCalledOnce();
    expect(onLetKoCreate).toHaveBeenCalledOnce();
  });

  /* Dropping straight onto the card skips the empty drop zone: one step
     fewer between the entry point and the designs. */
  it("takes a file dropped on the upload card", () => {
    const onFileDropped = vi.fn();
    render(
      <ImageChoice
        onUseOwnImage={vi.fn()}
        onLetKoCreate={vi.fn()}
        onFileDropped={onFileDropped}
      />,
    );
    const file = png();
    fireEvent.drop(
      screen.getByRole("button", { name: /use a specific image/i }),
      { dataTransfer: { files: [file] } },
    );
    expect(onFileDropped).toHaveBeenCalledWith(file);
  });

  /* The design-system outline (2px --primary): the old accent-glow ring
     measured 1.15:1 and was invisible in light mode. */
  it("draws the visible focus outline on both cards", () => {
    render(
      <ImageChoice
        onUseOwnImage={vi.fn()}
        onLetKoCreate={vi.fn()}
        onFileDropped={vi.fn()}
      />,
    );
    for (const name of [/use a specific image/i, /let ko create/i]) {
      const card = screen.getByRole("button", { name });
      expect(card).toHaveClass("focus-visible:focus-outline");
      expect(card.className).not.toContain("accent-glow");
    }
  });
});

describe("ImageDropzone", () => {
  /* The whole zone is one control: one Tab stop, the full area clickable,
     and the same visible outline as every other control. */
  it("is one keyboard stop with a visible focus outline", async () => {
    render(<ImageDropzone onFile={vi.fn()} />);
    await userEvent.tab();
    const zone = screen.getByRole("button", { name: "Choose image" });
    expect(zone).toHaveFocus();
    expect(zone).toHaveClass("focus-visible:focus-outline");
    expect(zone).toHaveAccessibleDescription(/PNG, JPEG or WEBP, up to 20 MB/);
    await userEvent.tab();
    expect(zone).not.toHaveFocus();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("opens the file picker from the keyboard", async () => {
    render(<ImageDropzone onFile={vi.fn()} />);
    const input = screen.getByTestId("design-image-input");
    const click = vi.spyOn(input, "click");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(click).toHaveBeenCalledOnce();
  });

  it("passes on a picked file", async () => {
    const onFile = vi.fn();
    render(<ImageDropzone onFile={onFile} />);
    const file = png();
    await userEvent.upload(screen.getByTestId("design-image-input"), file);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("passes on a dropped file and shows the drop target while dragging", () => {
    const onFile = vi.fn();
    render(<ImageDropzone onFile={onFile} />);
    const zone = screen.getByRole("button", { name: "Choose image" });
    fireEvent.dragOver(zone);
    expect(screen.getByText("Drop to use this image")).toBeInTheDocument();
    const file = png();
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
    expect(screen.getByText("Drag your image here")).toBeInTheDocument();
  });

  it("takes an image pasted from the clipboard", () => {
    const onFile = vi.fn();
    render(<ImageDropzone onFile={onFile} />);
    const file = png();
    const event = new Event("paste") as Event & {
      clipboardData: { files: File[] };
    };
    event.clipboardData = { files: [file] };
    window.dispatchEvent(event);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("announces why the last file was refused", () => {
    render(
      <ImageDropzone onFile={vi.fn()} rejection="scan.pdf isn't a PNG." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("scan.pdf");
    expect(
      screen.getByRole("button", { name: "Choose image" }),
    ).toHaveAccessibleDescription(/scan\.pdf/);
  });
});

const IMAGE: PickedImage = {
  name: "cake.png",
  bytes: 900 * 1024,
  previewUrl: "blob:cake",
  width: 2560,
  height: 1707,
};

function preview(state: Exclude<DesignImageUpload, { status: "idle" }>) {
  const handlers = {
    onRemove: vi.fn(),
    onReplace: vi.fn(),
    onRetry: vi.fn(),
  };
  render(<ImagePreview state={state} {...handlers} />);
  return handlers;
}

describe("ImagePreview", () => {
  it("shows the image, its size and that it is ready", () => {
    preview({ status: "ready", image: IMAGE, key: "k" });
    expect(screen.getByRole("img", { name: /cake\.png/ })).toHaveAttribute(
      "src",
      "blob:cake",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "900 KB · 2560 × 1707 px · Ready to use",
    );
  });

  it("shows upload progress without re-announcing every percent", () => {
    preview({ status: "uploading", image: IMAGE, fraction: 0.42 });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Uploading…/);
    expect(screen.getByRole("status")).toHaveAccessibleName("");
  });

  it("removes and replaces", async () => {
    const handlers = preview({ status: "ready", image: IMAGE, key: "k" });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(handlers.onRemove).toHaveBeenCalled();
    const file = png();
    await userEvent.upload(
      screen.getByTestId("design-image-replace-input"),
      file,
    );
    expect(handlers.onReplace).toHaveBeenCalledWith(file);
  });

  it.each([
    ["presign", /couldn't start/],
    ["upload", /stopped part way/],
  ] as const)("offers a retry when the %s step failed", async (step, lead) => {
    const handlers = preview({
      status: "error",
      image: IMAGE,
      step,
      message: "Network down",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(lead);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(handlers.onRetry).toHaveBeenCalled();
  });

  /* An unreadable file does not become readable by retrying it. The real
     normaliser message is said once: its prefix is the lead and its closing
     "Choose another image." is the button. */
  it("asks for a different file when the image could not be read", () => {
    preview({
      status: "error",
      image: IMAGE,
      step: "prepare",
      message: new ImageNotUsableError("undecodable").message,
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "This image can't be used. It couldn't be opened and may be damaged.",
    );
    expect(alert.textContent?.match(/can't be used/g)).toHaveLength(1);
    expect(alert.textContent?.match(/choose another/gi)).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Choose another" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});
