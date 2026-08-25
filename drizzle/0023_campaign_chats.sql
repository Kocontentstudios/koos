-- Campaign chats: a strategy is the campaign, pinned to the chat that produced it.

-- Set when the user renames a chat by hand, so neither the AI titler nor a later
-- strategy regeneration can clobber their title.
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS title_custom boolean NOT NULL DEFAULT false;

-- The card lookup on every chat reopen reads strategies by conversation.
CREATE INDEX IF NOT EXISTS strategies_conversation_id_idx
  ON strategies (conversation_id);
