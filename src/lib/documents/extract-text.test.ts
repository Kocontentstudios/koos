import { describe, expect, it } from "vitest";
import { extractDocumentText, MAX_DOCUMENT_CHARS } from "./extract-text";
import { docxFixture, pdfFixture, pptxFixture } from "./fixtures";

const GUIDELINES = [
  "Okra Kitchen Brand Guidelines",
  "Our primary colour is forest green.",
  "Headlines are set in Bricolage Grotesque.",
];

describe("every format the ticket names can be read", () => {
  it("reads a .txt", async () => {
    const { text } = await extractDocumentText(
      Buffer.from(GUIDELINES.join("\n"), "utf8"),
      "txt",
    );
    expect(text).toContain("Okra Kitchen");
    expect(text).toContain("forest green");
  });

  it("reads a .docx", async () => {
    const { text } = await extractDocumentText(docxFixture(GUIDELINES), "docx");
    expect(text).toContain("Okra Kitchen Brand Guidelines");
    expect(text).toContain("Bricolage Grotesque");
  });

  it("reads a .pptx", async () => {
    const { text } = await extractDocumentText(
      pptxFixture([["Okra Kitchen"], ["Primary colour", "forest green"]]),
      "pptx",
    );
    expect(text).toContain("Okra Kitchen");
    expect(text).toContain("forest green");
  });

  it("reads a .pdf", async () => {
    const { text } = await extractDocumentText(pdfFixture(GUIDELINES), "pdf");
    expect(text).toContain("Okra Kitchen");
    expect(text).toContain("Bricolage Grotesque");
  });
});

describe("slide order", () => {
  /* Zip entries come back in whatever order the archive lists them, and slide
     names sort lexicographically: slide10 before slide2. A deck read out of
     order hands the model a scrambled narrative. */
  it("reads slides numerically, not lexicographically", async () => {
    const slides = Array.from({ length: 12 }, (_, i) => [`Slide ${i + 1}`]);
    const { text } = await extractDocumentText(pptxFixture(slides), "pptx");
    expect(text.indexOf("Slide 2")).toBeLessThan(text.indexOf("Slide 10"));
    expect(text.indexOf("Slide 9")).toBeLessThan(text.indexOf("Slide 12"));
  });

  it("keeps every run on a slide", async () => {
    const { text } = await extractDocumentText(
      pptxFixture([["Mission", "To feed Lagos well"]]),
      "pptx",
    );
    expect(text).toContain("Mission");
    expect(text).toContain("To feed Lagos well");
  });

  /* Reading the raw part as prose would drag in relationship ids, theme names
     and layout junk that spends tokens and says nothing. */
  it("does not leak XML markup into the text", async () => {
    const { text } = await extractDocumentText(
      pptxFixture([["Mission"]]),
      "pptx",
    );
    expect(text).not.toMatch(/<a:t|p:sld|xmlns/);
  });
});

describe("XML entities are decoded, once", () => {
  it("decodes the predefined entities", async () => {
    const { text } = await extractDocumentText(
      pptxFixture([["Coffee &amp; Cake &lt;Lagos&gt;"]]),
      "pptx",
    );
    expect(text).toContain("Coffee & Cake <Lagos>");
  });

  /* &amp; is unescaped LAST, so an escaped entity survives as literal text
     rather than being decoded a second time into markup. */
  it("does not double-decode an escaped entity", async () => {
    const { text } = await extractDocumentText(
      pptxFixture([["Literally &amp;lt;br&amp;gt;"]]),
      "pptx",
    );
    expect(text).toContain("Literally &lt;br&gt;");
    expect(text).not.toContain("<br>");
  });
});

describe("the text is bounded", () => {
  /* This text becomes prompt input. An unbounded document is an unbounded
     bill, and past the model's context it is silently dropped anyway. */
  it("truncates a document past the cap and says so", async () => {
    const huge = "brand values ".repeat(MAX_DOCUMENT_CHARS);
    const { text, truncated } = await extractDocumentText(
      Buffer.from(huge, "utf8"),
      "txt",
    );
    expect(truncated).toBe(true);
    expect(text.length).toBe(MAX_DOCUMENT_CHARS);
  });

  it("does not claim truncation for a document that fits", async () => {
    const { text, truncated } = await extractDocumentText(
      Buffer.from("Okra Kitchen", "utf8"),
      "txt",
    );
    expect(truncated).toBe(false);
    expect(text).toBe("Okra Kitchen");
  });
});

describe("whitespace from layout is collapsed", () => {
  /* PDF and slide text arrives full of layout-derived blanks, which spend
     tokens without carrying meaning. */
  it("collapses runs of spaces and blank lines", async () => {
    const { text } = await extractDocumentText(
      Buffer.from("Okra    Kitchen\n\n\n\n\nLagos", "utf8"),
      "txt",
    );
    expect(text).toBe("Okra Kitchen\n\nLagos");
  });

  it("normalises Windows line endings", async () => {
    const { text } = await extractDocumentText(
      Buffer.from("Okra\r\nKitchen", "utf8"),
      "txt",
    );
    expect(text).toBe("Okra\nKitchen");
  });
});

describe("a document with nothing to say", () => {
  /* Not an error: "this PDF is a scan with no text layer" is a far more useful
     thing to tell a user than a stack trace, and only the caller can say it. */
  it("returns empty text rather than throwing", async () => {
    const { text, truncated } = await extractDocumentText(
      Buffer.from("   \n\n  ", "utf8"),
      "txt",
    );
    expect(text).toBe("");
    expect(truncated).toBe(false);
  });

  it("returns empty text for a deck with no slides", async () => {
    const { text } = await extractDocumentText(pptxFixture([]), "pptx");
    expect(text).toBe("");
  });
});

describe("a corrupt file fails loudly", () => {
  /* The route turns this into a message. Silently returning "" would show the
     user a confirmation card built from nothing. */
  it.each(["docx", "pptx"] as const)("throws on a broken %s", async (ext) => {
    await expect(
      extractDocumentText(Buffer.from("not a zip at all"), ext),
    ).rejects.toThrow();
  });

  it("throws on a broken pdf", async () => {
    await expect(
      extractDocumentText(Buffer.from("%PDF-1.4 truncated"), "pdf"),
    ).rejects.toThrow();
  });
});
