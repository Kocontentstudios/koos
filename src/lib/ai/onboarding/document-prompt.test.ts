import { describe, expect, it } from "vitest";
import { documentTranscript, MAX_DOCUMENT_TRANSCRIPT } from "./document-prompt";
import { MAX_TRANSCRIPT_LENGTH } from "./extraction";

const base = {
  fileName: "Brand Guidelines.pdf",
  text: "Okra Kitchen. Our primary colour is forest green.",
  truncated: false,
};

describe("a document framed as a transcript", () => {
  it("names the file so the model knows what it is reading", () => {
    expect(documentTranscript(base)).toContain("Brand Guidelines.pdf");
  });

  it("carries the document text", () => {
    expect(documentTranscript(base)).toContain("forest green");
  });

  /* The extraction SYSTEM_PROMPT reads a conversation. The document is
     presented as a turn in one so that prompt applies unchanged, rather than
     forking a second schema and a second definition of a brand. */
  it("reads as a user turn", () => {
    expect(documentTranscript(base)).toMatch(/^user:/m);
  });

  /* A deck describes an industry as well as a brand. Without this the model
     fills columns from what a restaurant usually sounds like. */
  it("tells the model not to infer beyond the document", () => {
    const out = documentTranscript(base);
    expect(out).toMatch(/only record what it actually says/i);
    expect(out).toMatch(/leave that field empty/i);
  });
});

describe("the conversation is kept alongside the document", () => {
  it("includes what the user already said, before the document", () => {
    const out = documentTranscript({
      ...base,
      conversation: "user: We're called Okra Kitchen and we're in Lagos.",
    });
    expect(out).toContain("Lagos");
    expect(out.indexOf("Lagos")).toBeLessThan(out.indexOf("forest green"));
  });

  it("omits the conversation section entirely when there is none", () => {
    expect(documentTranscript({ ...base, conversation: "   " })).toMatch(
      /^user: I've uploaded/,
    );
  });
});

describe("the framing fits the extractor's input budget", () => {
  /* The extract route validates the transcript against MAX_TRANSCRIPT_LENGTH.
     A document sized to the cap plus framing would be rejected by the very
     schema it was built for. */
  it("reserves room for the framing", () => {
    expect(MAX_DOCUMENT_TRANSCRIPT).toBeLessThan(MAX_TRANSCRIPT_LENGTH);
  });

  it("stays inside the cap for an enormous document", () => {
    const out = documentTranscript({
      ...base,
      text: "brand values ".repeat(20_000),
    });
    expect(out.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_LENGTH);
  });

  it("stays inside the cap with a long conversation too", () => {
    const out = documentTranscript({
      ...base,
      text: "brand values ".repeat(20_000),
      conversation: "user: hello. ".repeat(300),
    });
    expect(out.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_LENGTH);
  });

  /* Silently truncating a deck and presenting the result as the whole thing
     is the model confirming fields it never saw evidence for. */
  it("says so when the document was cut", () => {
    expect(documentTranscript({ ...base, truncated: true })).toMatch(
      /beginning of it/i,
    );
  });

  it("says so when the framing itself had to cut the text", () => {
    const out = documentTranscript({
      ...base,
      text: "brand values ".repeat(20_000),
    });
    expect(out).toMatch(/beginning of it/i);
  });

  it("does not claim truncation for a document that fits whole", () => {
    expect(documentTranscript(base)).not.toMatch(/beginning of it/i);
  });
});
