import { describe, expect, it } from "vitest";
import {
  isAttachmentType,
  mergeAttachments,
  type ResolvedAttachment,
  sortByPrecedence,
} from "@/lib/design/attachments";

const brief = (over: Partial<ResolvedAttachment> = {}): ResolvedAttachment => ({
  type: "brief",
  id: "b1",
  label: "Launch flyer brief",
  text: "A bold flyer for the launch.",
  designType: "Flyer",
  dimensions: "1080x1350",
  ...over,
});

const calendarItem = (
  over: Partial<ResolvedAttachment> = {},
): ResolvedAttachment => ({
  type: "calendar_item",
  id: "c1",
  label: "Friday teaser post",
  text: "Tease the drop.",
  designType: "Post",
  dimensions: "1080x1080",
  platform: "Instagram",
  scheduledFor: "2026-09-01",
  ...over,
});

const strategy = (
  over: Partial<ResolvedAttachment> = {},
): ResolvedAttachment => ({
  type: "strategy",
  id: "s1",
  label: "Q4 campaign",
  text: "Own the festive season.",
  ...over,
});

describe("isAttachmentType", () => {
  it("accepts the known types and rejects anything else", () => {
    expect(isAttachmentType("brief")).toBe(true);
    expect(isAttachmentType("asset")).toBe(true);
    expect(isAttachmentType("brand")).toBe(false);
    expect(isAttachmentType("")).toBe(false);
    expect(isAttachmentType(null)).toBe(false);
    expect(isAttachmentType(7)).toBe(false);
  });
});

describe("sortByPrecedence", () => {
  /* Without a fixed order, attaching the same two things in a different order
     would silently produce a different design. */
  it("orders most-specific first regardless of input order", () => {
    const ordered = sortByPrecedence([
      strategy(),
      { ...brief(), type: "asset", id: "a1" },
      calendarItem(),
      brief(),
    ]);
    // Assets sort last: they contribute an image, never a scalar.
    expect(ordered.map((a) => a.type)).toEqual([
      "brief",
      "calendar_item",
      "strategy",
      "asset",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const input = [strategy(), brief()];
    sortByPrecedence(input);
    expect(input.map((a) => a.type)).toEqual(["strategy", "brief"]);
  });
});

describe("mergeAttachments", () => {
  describe("brief text", () => {
    it("is null when there is nothing at all", () => {
      expect(mergeAttachments({ attachments: [] }).briefText).toBeNull();
    });

    /* One source needs no heading to be told apart from anything, so a lone
       brief or calendar item reads exactly as it did before attachments
       existed — the calendar and chat entry points are unchanged. */
    it("leaves a single source unheaded", () => {
      expect(
        mergeAttachments({ freeform: "Make it teal", attachments: [] })
          .briefText,
      ).toBe("Make it teal");
      expect(mergeAttachments({ attachments: [strategy()] }).briefText).toBe(
        "Own the festive season.",
      );
    });

    /* The prompt is what the user asked for just now. Burying it under the
       attached documents makes the model answer the documents instead. */
    it("leads with the prompt, then each attachment under its own heading", () => {
      const merged = mergeAttachments({
        freeform: "Create this as an Instagram post.",
        attachments: [strategy(), brief()],
      });

      expect(merged.briefText).toBe(
        [
          "## Your prompt\n\nCreate this as an Instagram post.",
          "## Launch flyer brief\n\nA bold flyer for the launch.",
          "## Q4 campaign\n\nOwn the festive season.",
        ].join("\n\n"),
      );
    });

    it("keeps attachment blocks in precedence order, not input order", () => {
      const merged = mergeAttachments({
        attachments: [strategy(), calendarItem(), brief()],
      });
      const headings = [
        ...(merged.briefText ?? "").matchAll(/^## (.+)$/gm),
      ].map((m) => m[1]);
      expect(headings).toEqual([
        "Launch flyer brief",
        "Friday teaser post",
        "Q4 campaign",
      ]);
    });

    it("skips an attachment that contributes no prose", () => {
      const merged = mergeAttachments({
        freeform: "Use this logo",
        attachments: [
          {
            type: "asset",
            id: "a1",
            label: "logo.png",
            text: null,
            fileUrl: "https://cdn/logo.png",
          },
        ],
      });
      expect(merged.briefText).toBe("Use this logo");
    });

    it("ignores a whitespace-only prompt", () => {
      expect(
        mergeAttachments({ freeform: "   ", attachments: [] }).briefText,
      ).toBeNull();
    });
  });

  describe("scalar precedence", () => {
    it("takes each scalar from the most specific attachment that has one", () => {
      const merged = mergeAttachments({
        attachments: [calendarItem(), brief()],
      });
      // Brief outranks the calendar item for the fields both supply...
      expect(merged.designType).toBe("Flyer");
      expect(merged.dimensions).toBe("1080x1350");
      // ...but the calendar item is still the only source of these.
      expect(merged.platform).toBe("Instagram");
      expect(merged.scheduledFor).toBe("2026-09-01");
    });

    it("falls through when the higher-precedence attachment leaves a gap", () => {
      const merged = mergeAttachments({
        attachments: [
          calendarItem(),
          brief({ designType: null, dimensions: null }),
        ],
      });
      expect(merged.designType).toBe("Post");
      expect(merged.dimensions).toBe("1080x1080");
    });

    it("treats blank strings as absent", () => {
      const merged = mergeAttachments({
        attachments: [calendarItem(), brief({ designType: "  " })],
      });
      expect(merged.designType).toBe("Post");
    });

    it("is null for a scalar nothing supplies", () => {
      const merged = mergeAttachments({ attachments: [strategy()] });
      expect(merged.platform).toBeNull();
      expect(merged.designType).toBeNull();
    });

    it("titles the generation after the leading attachment", () => {
      expect(
        mergeAttachments({ attachments: [strategy(), brief()] }).title,
      ).toBe("Launch flyer brief");
      expect(mergeAttachments({ attachments: [] }).title).toBeNull();
    });
  });

  describe("aspect ratio", () => {
    it("derives from the winning dimensions", () => {
      expect(mergeAttachments({ attachments: [brief()] }).aspectRatio).toBe(
        "4:5",
      );
      expect(
        mergeAttachments({ attachments: [calendarItem()] }).aspectRatio,
      ).toBe("1:1");
    });

    /* The dropdown is a deliberate choice; an attachment's dimensions are an
       inference. The explicit one has to win or the control does nothing. */
    it("lets an explicit choice override the attachment", () => {
      expect(
        mergeAttachments({ attachments: [brief()], aspectRatio: "16:9" })
          .aspectRatio,
      ).toBe("16:9");
    });

    it("falls back to square with nothing to go on", () => {
      expect(mergeAttachments({ attachments: [] }).aspectRatio).toBe("1:1");
    });
  });

  describe("reference images", () => {
    it("collects every attached file, in precedence order", () => {
      const merged = mergeAttachments({
        attachments: [
          {
            type: "asset",
            id: "a2",
            label: "b.png",
            text: null,
            fileUrl: "u2",
          },
          {
            type: "asset",
            id: "a1",
            label: "a.png",
            text: null,
            fileUrl: "u1",
          },
          brief(),
        ],
      });
      expect(merged.referenceUrls).toEqual(["u2", "u1"]);
    });

    it("is empty when nothing carries a file", () => {
      expect(
        mergeAttachments({ attachments: [brief()] }).referenceUrls,
      ).toEqual([]);
    });
  });

  it("handles the ticket's worked example: prompt plus brief plus calendar item", () => {
    const merged = mergeAttachments({
      freeform: "Create this as an Instagram post.",
      attachments: [brief(), calendarItem()],
    });

    expect(merged.briefText).toContain("Create this as an Instagram post.");
    expect(merged.briefText).toContain("A bold flyer for the launch.");
    expect(merged.briefText).toContain("Tease the drop.");
    expect(merged.platform).toBe("Instagram");
  });
});
