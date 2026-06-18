import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileUpload } from "./file-upload";

function makeFile(name: string, type: string, sizeBytes: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: sizeBytes });
  return f;
}

describe("FileUpload", () => {
  it("shows the upload prompt by default", () => {
    render(<FileUpload onFileSelected={() => {}} />);
    expect(screen.getByText(/click to upload/i)).toBeInTheDocument();
  });
  it("calls onFileSelected for a valid file", async () => {
    const onFileSelected = vi.fn();
    render(
      <FileUpload
        accept="image/png"
        maxSizeMb={5}
        onFileSelected={onFileSelected}
      />,
    );
    const input = screen.getByTestId("file-input");
    await userEvent.upload(input, makeFile("logo.png", "image/png", 1000));
    expect(onFileSelected).toHaveBeenCalledTimes(1);
  });
  it("rejects an oversized file with an error and no callback", async () => {
    const onFileSelected = vi.fn();
    render(
      <FileUpload
        accept="image/png"
        maxSizeMb={1}
        onFileSelected={onFileSelected}
      />,
    );
    const input = screen.getByTestId("file-input");
    await userEvent.upload(
      input,
      makeFile("big.png", "image/png", 5 * 1024 * 1024),
    );
    expect(onFileSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/too large|5 ?mb|exceeds/i)).toBeInTheDocument();
  });
  it("shows the filename and a remove button in the uploaded state", async () => {
    const onRemove = vi.fn();
    render(
      <FileUpload
        onFileSelected={() => {}}
        fileName="logo.png"
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
  });
});
