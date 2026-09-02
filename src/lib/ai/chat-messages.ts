import type { UIMessage } from "ai";
import { stripPollMarker } from "@/lib/onboarding/chips";

export type StoredMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/** Concatenate every text part of a UIMessage into a plain string. */
export function flattenMessageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter(
      (p): p is Extract<(typeof message.parts)[number], { type: "text" }> =>
        p.type === "text",
    )
    .map((p) => p.text)
    .join("");
}

/** Rebuild UIMessages from stored flat rows for seeding useChat.
 *
 * Poll markers are stripped again on the way out. They are removed before
 * storage, but rows written before that shipped still carry them, and this is
 * the single door every stored conversation comes back through. */
export function rowsToUiMessages(rows: StoredMessageRow[]): UIMessage[] {
  return rows.map(
    (row) =>
      ({
        id: row.id,
        role: row.role,
        parts: [
          {
            type: "text",
            /* Assistant rows only. A user who types or pastes "[[poll:x]]"
               owns those characters; silently deleting them from their own
               message on reload is our protocol leaking into their content. */
            text:
              row.role === "assistant"
                ? stripPollMarker(row.content)
                : row.content,
          },
        ],
      }) as UIMessage,
  );
}
