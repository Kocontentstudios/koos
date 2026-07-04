import type { UIMessage } from "ai";

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

/** Rebuild UIMessages from stored flat rows for seeding useChat. */
export function rowsToUiMessages(rows: StoredMessageRow[]): UIMessage[] {
  return rows.map(
    (row) =>
      ({
        id: row.id,
        role: row.role,
        parts: [{ type: "text", text: row.content }],
      }) as UIMessage,
  );
}
