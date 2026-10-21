import { describe, expect, it } from "vitest";
import {
  assembleDesignBrief,
  designBriefSchema,
  designBriefUpdateSchema,
} from "./design-brief-schema";

const valid = {
  title: "Summer Sale Carousel",
  designType: "Instagram Carousel (1080x1350 per slide)",
  dimensions: "1080x1350",
  slides: 5,
  briefMarkdown: "**Title**\nSummer Sale\n\n**Objective**\nDrive signups",
};

describe("designBriefSchema", () => {
  it("accepts a complete brief", () => {
    expect(designBriefSchema.parse(valid)).toMatchObject(valid);
  });

  it("accepts a minimal brief without optional fields", () => {
    expect(() =>
      designBriefSchema.parse({
        title: "Flyer",
        designType: "Other",
        briefMarkdown: "**Request Title**\nFlyer",
      }),
    ).not.toThrow();
  });

  it("rejects an empty briefMarkdown", () => {
    expect(
      designBriefSchema.safeParse({ ...valid, briefMarkdown: "" }).success,
    ).toBe(false);
  });

  it("bounds slides to 2-10", () => {
    expect(designBriefSchema.safeParse({ ...valid, slides: 1 }).success).toBe(
      false,
    );
    expect(designBriefSchema.safeParse({ ...valid, slides: 11 }).success).toBe(
      false,
    );
  });
});

describe("designBriefUpdateSchema", () => {
  it("accepts a partial update", () => {
    const parsed = designBriefUpdateSchema.parse({ title: "New title" });
    expect(parsed).toEqual({ title: "New title" });
  });

  it("allows clearing optional fields with null", () => {
    const parsed = designBriefUpdateSchema.parse({
      dimensions: null,
      slides: null,
      notes: null,
    });
    expect(parsed).toEqual({ dimensions: null, slides: null, notes: null });
  });

  it("rejects emptying required fields", () => {
    expect(designBriefUpdateSchema.safeParse({ title: "" }).success).toBe(
      false,
    );
    expect(
      designBriefUpdateSchema.safeParse({ briefMarkdown: "" }).success,
    ).toBe(false);
  });

  it("rejects an empty update", () => {
    expect(designBriefUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields like ticketId", () => {
    expect(designBriefUpdateSchema.safeParse({ ticketId: "t-1" }).success).toBe(
      false,
    );
  });
});

/* KOOS-AI-001, the ticket's first acceptance criterion: "KO OS identifies the
   correct design type BEFORE writing the brief." It used to decide the type
   and write the brief in one generateObject call, against four templates and
   an instruction to pick one. Identification is now its own step and the
   brief step consumes its answer, so these two schemas have to compose back
   into exactly the shape the Design Brief Card and the ticket submit already
   store. */
describe("assembleDesignBrief", () => {
  const content = {
    title: "Launch Flyer",
    briefMarkdown: "**Request Title**\n\nLaunch Flyer",
    notes: "",
  };

  it("takes the deliverable from the identification step, not the prose step", () => {
    const brief = assembleDesignBrief(
      { designType: "Flyer", dimensions: "1080x1350", slides: 0 },
      content,
    );
    expect(brief.designType).toBe("Flyer");
    expect(brief.dimensions).toBe("1080x1350");
    expect(brief.title).toBe("Launch Flyer");
  });

  /* The format's own default, not a sentence in a prompt asking a model to
     remember that Instagram posts are 1080x1350. */
  it("falls back to the format's canvas when the request never stated one", () => {
    expect(
      assembleDesignBrief(
        { designType: "Video Thumbnail", dimensions: "", slides: 0 },
        content,
      ).dimensions,
    ).toBe("1344x756");
  });

  /* A format the renderer cannot produce has no default to offer, and a brief
     claiming a pixel size for a dieline would be inventing a specification. */
  it("leaves dimensions unset when the format has no producible canvas", () => {
    expect(
      assembleDesignBrief(
        { designType: "Packaging", dimensions: "", slides: 0 },
        content,
      ).dimensions,
    ).toBeUndefined();
  });

  /* Zero is the sentinel for "one frame": designBriefSchema's slides starts at
     2, and a required number survives Bedrock's decoding grammar where an
     optional one is a union. */
  it("drops a zero slide count instead of storing it", () => {
    const single = assembleDesignBrief(
      { designType: "Flyer", dimensions: "1080x1350", slides: 0 },
      content,
    );
    expect(single.slides).toBeUndefined();
    expect(
      assembleDesignBrief(
        { designType: "Carousel", dimensions: "1080x1350", slides: 5 },
        content,
      ).slides,
    ).toBe(5);
  });

  it("drops empty notes rather than storing a blank string", () => {
    expect(
      assembleDesignBrief(
        { designType: "Flyer", dimensions: "", slides: 0 },
        { ...content, notes: "  " },
      ).notes,
    ).toBeUndefined();
  });

  /* Whatever comes out has to pass the schema the rest of the app validates
     against, or the two-step refactor has moved the failure rather than fixed
     anything. */
  it("produces something designBriefSchema accepts", () => {
    const brief = assembleDesignBrief(
      { designType: "Carousel", dimensions: "", slides: 4 },
      { ...content, notes: "avoid stock photography" },
    );
    expect(designBriefSchema.safeParse(brief).success).toBe(true);
  });
});

/* Round-2 review: the model's `dimensions` was taken as stated whatever it
   said, overriding the one value in this function that was actually tested. */
describe("assembleDesignBrief dimensions", () => {
  const content = {
    title: "Launch Flyer",
    briefMarkdown: "**Request Title**\n\nLaunch Flyer",
    notes: "",
  };
  const dims = (dimensions: string) =>
    assembleDesignBrief(
      { designType: "Social Media Post", dimensions, slides: 0 },
      content,
    ).dimensions;

  it.each(["A2", "roughly square", "not sure", "1080", "x", "1080 by 1350"])(
    "falls back to the format's canvas for %s",
    (stated) => {
      expect(dims(stated)).toBe("1080x1350");
    },
  );

  it.each([
    ["1920x1080", "1920x1080"],
    ["1920 x 1080", "1920x1080"],
    ["1920×1080", "1920x1080"],
  ])("accepts and normalises %s", (stated, expected) => {
    expect(dims(stated)).toBe(expected);
  });

  /* The composed brief is what the Design Brief Card renders and the ticket
     submit stores, and it was the one shape in the two-step flow that nothing
     validated. */
  it("refuses to assemble something the stored schema would reject", () => {
    expect(() =>
      assembleDesignBrief(
        { designType: "Flyer", dimensions: "", slides: 0 },
        { ...content, title: "" },
      ),
    ).toThrow();
  });
});
