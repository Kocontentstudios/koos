-- KOOS-V1-BUG-027 / BUG-028: the onboarding chat could never be resumed.
-- OnboardingClient minted a fresh conversation id on every mount and loaded no
-- history, so a refresh started KO over from the first question. Conversations
-- carry mode 'strategy' | 'design' and an onboarding chat is stored as
-- 'strategy', so nothing identified which conversation WAS the onboarding one.
--
-- Additive and nullable: the running bundle never names this column, so it is
-- safe in a single deploy. ON DELETE SET NULL because deleting the chat must
-- not take the brand with it — the brand simply has no session to resume.
ALTER TABLE "brands"
  ADD COLUMN IF NOT EXISTS "onboarding_conversation_id" uuid
  REFERENCES "chat_conversations"("id") ON DELETE SET NULL;
