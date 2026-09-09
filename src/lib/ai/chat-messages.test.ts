import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  flattenMessageText,
  rowsToUiMessages,
  type StoredMessageRow,
} from "./chat-messages";

function uiMsg(role: "user" | "assistant", ...texts: string[]): UIMessage {
  return {
    id: `m-${role}`,
    role,
    parts: texts.map((t) => ({ type: "text", text: t })),
  } as UIMessage;
}

describe("flattenMessageText", () => {
  it("joins all text parts in order", () => {
    expect(flattenMessageText(uiMsg("user", "Hello ", "world"))).toBe(
      "Hello world",
    );
  });

  it("returns empty string when there are no text parts", () => {
    const msg = { id: "x", role: "assistant", parts: [] } as UIMessage;
    expect(flattenMessageText(msg)).toBe("");
  });
});

describe("rowsToUiMessages", () => {
  it("reconstructs UIMessages preserving id, role and text", () => {
    const rows: StoredMessageRow[] = [
      { id: "a", role: "user", content: "hi" },
      { id: "b", role: "assistant", content: "hello there" },
    ];
    const result = rowsToUiMessages(rows);
    expect(result).toEqual([
      { id: "a", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "b",
        role: "assistant",
        parts: [{ type: "text", text: "hello there" }],
      },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(rowsToUiMessages([])).toEqual([]);
  });
});

/* An onboarding chat is persisted as a `strategy` conversation, so Recent
   Chats reopens it and renders the stored content. Markers are stripped before
   storage now, but rows written earlier still carry them and this is the one
   door every stored conversation comes back through. */
describe("stored history never carries a poll marker", () => {
  it("strips a marker left in an older row", () => {
    const [message] = rowsToUiMessages([
      {
        id: "m1",
        role: "assistant",
        content: "What sets you apart? [[poll:differentiation]]",
      },
    ]);
    expect(message.parts).toEqual([
      { type: "text", text: "What sets you apart?" },
    ]);
  });

  it("strips a marker whose kind is not one we know", () => {
    const [message] = rowsToUiMessages([
      { id: "m1", role: "assistant", content: "Q? [[poll:market-gap]]" },
    ]);
    expect(JSON.stringify(message.parts)).not.toContain("[[poll:");
  });

  /* Every stored conversation in every mode comes back through here, so a
     transform wider than the marker reformats strategy and design answers
     that have nothing to do with this feature. */
  it.each([
    "Channels:\n\n- Instagram\n  - Reels 3x/wk\n- TikTok",
    "Run:\n\n    npm run build",
    "line one  \nline two",
  ])("does not reformat assistant markdown: %j", (content) => {
    const [message] = rowsToUiMessages([
      { id: "m1", role: "assistant", content },
    ]);
    expect(message.parts).toEqual([{ type: "text", text: content }]);
  });

  /* A user who types the token owns those characters. */
  it("never rewrites a user's own message", () => {
    const content = "why does it say [[poll:tone]] ?";
    const [message] = rowsToUiMessages([{ id: "m1", role: "user", content }]);
    expect(message.parts).toEqual([{ type: "text", text: content }]);
  });

  it("leaves ordinary content alone", () => {
    const [message] = rowsToUiMessages([
      { id: "m1", role: "user", content: "Bold, Warm" },
    ]);
    expect(message.parts).toEqual([{ type: "text", text: "Bold, Warm" }]);
  });
});
