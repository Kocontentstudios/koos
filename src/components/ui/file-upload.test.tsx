import { fireEvent, render, screen } from "@testing-library/react";
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

/* ── KOOS-BUG-013 ──────────────────────────────────────────────────────── */

/* The reported bug: the field advertises .ttf/.otf/.ttc and refused all three
   with "Unsupported file type", because every accept entry was compared
   against file.type — so an extension entry could never match, and .ttc had
   no MIME entry at all. */
describe("accept matches extensions as well as MIME types", () => {
  const FONT_ACCEPT = ".ttf,.otf,.ttc,font/ttf,font/otf";

  const drop = (file: File) => {
    const onFileSelected = vi.fn();
    render(<FileUpload accept={FONT_ACCEPT} onFileSelected={onFileSelected} />);
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [file] },
    });
    return onFileSelected;
  };

  /* Browsers disagree wildly on a font's MIME. Every one of these is a real
     value a browser sends for a .ttf, and all of them must be accepted. */
  it.each([
    ["font/ttf", "font/ttf"],
    ["application/octet-stream", "application/octet-stream"],
    ["font/sfnt", "font/sfnt"],
    ["application/x-font-ttf", "application/x-font-ttf"],
    ["no MIME at all", ""],
  ])("accepts a .ttf sent as %s", (_label, mime) => {
    const onFileSelected = drop(new File(["x"], "Brand.ttf", { type: mime }));
    expect(onFileSelected).toHaveBeenCalled();
    expect(screen.queryByText(/unsupported file type/i)).toBeNull();
  });

  /* .ttc appears in the accept list but has NO MIME entry, so before this fix
     it was unuploadable by every browser, not just some. */
  it.each([".otf", ".ttc"])("accepts a %s file", (ext) => {
    const onFileSelected = drop(
      new File(["x"], `Brand${ext}`, { type: "application/octet-stream" }),
    );
    expect(onFileSelected).toHaveBeenCalled();
  });

  it("is case-insensitive about the extension", () => {
    expect(drop(new File(["x"], "BRAND.TTF", { type: "" }))).toHaveBeenCalled();
  });

  /* Both SIDES are normalised, not just the filename. An accept list written
     ".TTF" or "Font/TTF" is valid HTML and must behave identically. */
  it.each([
    [".TTF,.OTF", "Brand.ttf", ""],
    ["Font/TTF", "Brand.ttf", "font/ttf"],
    ["IMAGE/*", "logo.png", "image/png"],
    /* And the MIME the BROWSER sends, which Safari has historically
       upper-cased on some types. */
    ["font/ttf", "Brand.ttf", "FONT/TTF"],
    ["image/*", "logo.png", "IMAGE/PNG"],
  ])("normalises an accept entry written as %s", (accept, name, mime) => {
    const onFileSelected = vi.fn();
    render(<FileUpload accept={accept} onFileSelected={onFileSelected} />);
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File(["x"], name, { type: mime })] },
    });
    expect(onFileSelected).toHaveBeenCalled();
  });

  /* The list still has to REFUSE things, or the fix has simply disabled it. */
  it.each(["Brand.woff2", "logo.png", "notes.txt", "font.ttf.exe"])(
    "still refuses %s",
    (name) => {
      const onFileSelected = drop(new File(["x"], name, { type: "" }));
      expect(onFileSelected).not.toHaveBeenCalled();
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    },
  );

  /* A name that merely CONTAINS the extension is not a match — "myttf" is not
     a .ttf, and the check must anchor at the end. */
  it("refuses a name that only contains the extension", () => {
    expect(drop(new File(["x"], "myttf", { type: "" }))).not.toHaveBeenCalled();
  });
});

describe("MIME matching still works for the other consumers", () => {
  it("accepts a PNG under image/*", () => {
    const onFileSelected = vi.fn();
    render(<FileUpload accept="image/*" onFileSelected={onFileSelected} />);
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    expect(onFileSelected).toHaveBeenCalled();
  });

  it("refuses a PDF under image/*", () => {
    const onFileSelected = vi.fn();
    render(<FileUpload accept="image/*" onFileSelected={onFileSelected} />);
    fireEvent.change(screen.getByTestId("file-input"), {
      target: {
        files: [new File(["x"], "a.pdf", { type: "application/pdf" })],
      },
    });
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("accepts an exact MIME match", () => {
    const onFileSelected = vi.fn();
    render(
      <FileUpload accept="image/svg+xml" onFileSelected={onFileSelected} />,
    );
    fireEvent.change(screen.getByTestId("file-input"), {
      target: {
        files: [new File(["x"], "a.svg", { type: "image/svg+xml" })],
      },
    });
    expect(onFileSelected).toHaveBeenCalled();
  });

  /* No accept list means no constraint, not "refuse everything". */
  it("accepts anything when no accept list is given", () => {
    const onFileSelected = vi.fn();
    render(<FileUpload onFileSelected={onFileSelected} />);
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File(["x"], "whatever.xyz", { type: "" })] },
    });
    expect(onFileSelected).toHaveBeenCalled();
  });
});
