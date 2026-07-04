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
