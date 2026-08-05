import { describe, expect, it } from "vitest";
import {
  attachmentKeyBelongsToUser,
  buildAttachmentKey,
  designRequestSchema,
  draftRequestSchema,
  isAllowedUpload,
  presignRequestSchema,
} from "./request-form";

const base = {
  brandId: "0b6f1c2e-1111-4222-8333-444455556666",
  requestType: "Flyer",
  title: "Launch flyer",
  brief: "A flyer for our launch.",
  priority: "normal" as const,
  attachments: [],
};

describe("designRequestSchema", () => {
  it("accepts a complete submission", () => {
    expect(designRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a missing brief", () => {
    expect(designRequestSchema.safeParse({ ...base, brief: "" }).success).toBe(
      false,
    );
  });

  it("accepts file and link attachments with categories and notes", () => {
    const parsed = designRequestSchema.safeParse({
      ...base,
      dueDate: "2026-08-20",
      specs: {
        platform: "Instagram",
        orientation: "portrait",
        deliverablesCount: 3,
      },
      attachments: [
        {
          kind: "file",
          key: "reference-images/u1/a-logo.png",
          fileName: "logo.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          category: "asset",
        },
        {
          kind: "link",
          url: "https://drive.google.com/file/d/x",
          category: "reference",
          note: "Love the color blocking",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-http link protocols", () => {
    const bad = {
      ...base,
      attachments: [
        { kind: "link", url: "javascript:alert(1)", category: "reference" },
      ],
    };
    expect(designRequestSchema.safeParse(bad).success).toBe(false);
  });

  it("defaults priority to normal and attachments to empty", () => {
    const parsed = designRequestSchema.parse({
      brandId: base.brandId,
      requestType: "Logo",
      title: "New logo",
      brief: "Something bold.",
    });
    expect(parsed.priority).toBe("normal");
    expect(parsed.attachments).toEqual([]);
  });
});

describe("draftRequestSchema", () => {
  it("allows missing fields when a title is present", () => {
    expect(
      draftRequestSchema.safeParse({ brandId: base.brandId, title: "wip" })
        .success,
    ).toBe(true);
  });

  it("allows a brief-only draft", () => {
    expect(
      draftRequestSchema.safeParse({ brandId: base.brandId, brief: "notes" })
        .success,
    ).toBe(true);
  });

  it("rejects a draft with neither title nor brief", () => {
    expect(draftRequestSchema.safeParse({ brandId: base.brandId }).success).toBe(
      false,
    );
  });
});

describe("isAllowedUpload", () => {
  it("allows the spec's file families", () => {
    const cases: Array<[string, string]> = [
      ["a.png", "image/png"],
      ["b.pdf", "application/pdf"],
      [
        "c.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      ["d.mp4", "video/mp4"],
      ["e.zip", "application/zip"],
      ["f.jpeg", "image/jpeg"],
    ];
    for (const [name, mime] of cases) {
      expect(isAllowedUpload(name, mime), name).toBe(true);
    }
  });

  it("rejects executables and mismatched extensions", () => {
    expect(isAllowedUpload("evil.exe", "application/octet-stream")).toBe(false);
    expect(isAllowedUpload("evil.png.exe", "image/png")).toBe(false);
    expect(isAllowedUpload("noext", "image/png")).toBe(false);
  });
});

describe("presignRequestSchema", () => {
  it("caps file size at 100MB", () => {
    expect(
      presignRequestSchema.safeParse({
        brandId: base.brandId,
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 101 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });

  it("accepts a valid presign request", () => {
    expect(
      presignRequestSchema.safeParse({
        brandId: base.brandId,
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 1024,
      }).success,
    ).toBe(true);
  });
});

describe("attachment keys", () => {
  it("namespaces keys per user and verifies ownership", () => {
    const key = buildAttachmentKey("user-1", "My Logo!.png", "abc123");
    expect(key.startsWith("reference-images/user-1/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    expect(attachmentKeyBelongsToUser(key, "user-1")).toBe(true);
    expect(attachmentKeyBelongsToUser(key, "user-2")).toBe(false);
  });

  it("does not treat a prefix-sharing user id as owner", () => {
    expect(
      attachmentKeyBelongsToUser("reference-images/user-11/x.png", "user-1"),
    ).toBe(false);
  });
});
