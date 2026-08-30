"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { Send, Sparkles, Square, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ProposalCard } from "@/components/ai/proposal-card";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceIo } from "@/hooks/use-voice-io";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import type { Proposal } from "@/lib/ai/tools/proposals";
import type { BrandSnapshotFields } from "@/lib/brand-snapshot";
import {
  type ChipPrompt,
  detectChipPrompt,
  formatChipSelection,
  stripPollMarker,
} from "@/lib/onboarding/chips";
import { BrandSnapshotCard } from "../brand-snapshot-card";
import { saveVisualIdentity } from "./actions";
import { ChipPicker } from "./chip-picker";
import {
  VisualIdentityStep,
  type VisualIdentityValues,
} from "./visual-identity-step";

interface OnboardingClientProps {
  brandId: string;
  brandContext: ChatBrandContext;
}

/* The poll marker is protocol between the prompt and ChipPicker, never
   content: it is stripped here so it cannot reach the screen, the read-aloud
   voice, or the transcript the extractor reads. */
function messageText(msg: UIMessage): string {
  /* Assistant turns only, matching rowsToUiMessages: a user who types
     "[[poll:tone]]" owns those characters, and stripping them from their own
     bubble shows them something different from what was sent. */
  return msg.role === "assistant"
    ? stripPollMarker(rawMessageText(msg))
    : rawMessageText(msg);
}

function rawMessageText(msg: UIMessage): string {
  return (
    msg.parts
      ?.filter(
        (p): p is Extract<typeof p, { type: "text" }> => p.type === "text",
      )
      .map((p) => p.text)
      .join("") ?? ""
  );
}

function ReadAloudButton({
  isSpeaking,
  onToggle,
}: {
  isSpeaking: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isSpeaking}
      aria-label={isSpeaking ? "Stop reading aloud" : "Read aloud"}
      className="mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      {isSpeaking ? (
        <Square aria-hidden="true" className="w-3 h-3" />
      ) : (
        <Volume2 aria-hidden="true" className="w-3 h-3" />
      )}
      {isSpeaking ? "Stop" : "Read aloud"}
    </button>
  );
}

export function OnboardingClient({
  brandId,
  brandContext,
}: OnboardingClientProps) {
  const router = useRouter();
  const conversationId = useState(() => crypto.randomUUID())[0];
  const [input, setInput] = useState("");
  const [snapshot, setSnapshot] = useState<BrandSnapshotFields | null>(null);
  /* Sits between the conversation and the snapshot: the chat cannot carry a
     file upload, and the design engine needs a logo and colours more than it
     needs another paragraph. */
  const [visualStep, setVisualStep] = useState<BrandSnapshotFields | null>(
    null,
  );
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const voice = useVoiceIo();

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { brandContext, brandId, conversationId, mode: "onboarding" },
      }),
    [brandContext, brandId, conversationId],
  );

  const { messages, status, sendMessage, stop, error } = useChat({
    transport,
  });
  const isLoading = status === "submitted" || status === "streaming";

  /* Chips belong to the question that is still open, so they hang off the
     final message and only while it is KO's. Once the user answers — by chip
     or by typing — their turn becomes the last message and these disappear on
     their own. */
  const lastMessage = messages[messages.length - 1];
  const chipPrompt: ChipPrompt | null =
    !isLoading && lastMessage?.role === "assistant"
      ? detectChipPrompt(rawMessageText(lastMessage))
      : null;

  function handleChipSubmit(kind: ChipPrompt, selected: string[]) {
    const text = formatChipSelection(kind, selected);
    if (!text) return;
    sendMessage(
      { text },
      { body: { brandContext, brandId, conversationId, mode: "onboarding" } },
    );
  }

  function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage(
      { text },
      { body: { brandContext, brandId, conversationId, mode: "onboarding" } },
    );
    setInput("");
  }

  async function handleFillProfile() {
    if (extracting) return;
    const fullTranscript = messages
      .map((m) => `${m.role}: ${messageText(m)}`)
      .join("\n\n")
      .trim();
    if (!fullTranscript) {
      toast.error("Have a bit of a conversation first, then try again.");
      return;
    }
    // Mirror the extract route's MAX_TRANSCRIPT_LENGTH cap; keep the tail
    // since the most recent turns matter most for a long conversation.
    const transcript = fullTranscript.slice(-8000);
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/brand/onboarding/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, transcript }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Couldn't capture your brand yet.";
        setExtractError(msg);
        toast.error(msg);
        return;
      }
      const data = (await res.json()) as { proposal: Proposal };
      setProposal(data.proposal);
    } catch {
      const msg = "Network error. Please try again.";
      setExtractError(msg);
      toast.error(msg);
    } finally {
      setExtracting(false);
    }
  }

  /* Replaces the chat entirely once the profile is captured: the conversation
     is finished, and leaving it behind the card invites the user to keep
     talking to a brand that is already written. */
  if (snapshot) {
    return <BrandSnapshotCard brand={snapshot} />;
  }

  if (visualStep) {
    return (
      <VisualIdentityStep
        brandId={brandId}
        initial={{
          logoUrl: visualStep.logoUrl ?? "",
          primaryColor: visualStep.primaryColor ?? "",
          secondaryColor: visualStep.secondaryColor ?? "",
        }}
        onSkip={() => setSnapshot(visualStep)}
        onSave={async (values: VisualIdentityValues) => {
          const result = await saveVisualIdentity(brandId, values);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.refresh();
          setSnapshot(result.snapshot);
        }}
      />
    );
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden -mx-4 -my-6 md:-mx-8 md:-my-8">
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-start gap-3 max-w-[85%]">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 text-white font-bold text-[11px]">
              KO
            </div>
            <div className="rounded-xl rounded-tl-sm border border-[var(--border)] bg-surface-1 px-4 py-3 text-sm leading-relaxed text-foreground">
              Hi! I'm KO. Let's get to know your brand — I'll ask a few
              questions, one at a time, and whenever you're ready you can hit
              "Fill my brand profile" to save what we've covered.
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const text = messageText(msg);
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 max-w-[85%] ${isUser ? "ml-auto flex-row-reverse" : ""}`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold text-[11px] ${
                  isUser
                    ? "bg-surface-2 text-foreground"
                    : "bg-primary text-white"
                }`}
              >
                {isUser ? "U" : "KO"}
              </div>
              <div className="min-w-0">
                <div
                  className={`min-w-0 break-words rounded-xl border px-4 py-3 text-sm leading-relaxed text-foreground ${
                    isUser
                      ? "bg-surface-2 border-[var(--border-accent)] rounded-tr-sm whitespace-pre-line"
                      : "bg-surface-1 border-[var(--border)] rounded-tl-sm"
                  }`}
                >
                  {isUser ? text : <Markdown>{text}</Markdown>}
                </div>
                {!isUser && text.trim() && (
                  <ReadAloudButton
                    isSpeaking={voice.speakingId === msg.id}
                    onToggle={() =>
                      voice.speakingId === msg.id
                        ? voice.cancel()
                        : voice.speak(text, msg.id)
                    }
                  />
                )}
              </div>
            </div>
          );
        })}

        {chipPrompt && lastMessage && (
          <ChipPicker
            key={lastMessage.id}
            kind={chipPrompt}
            onSubmit={(selected) => handleChipSubmit(chipPrompt, selected)}
          />
        )}

        {isLoading && (
          <div className="flex items-start gap-3 max-w-[85%]">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 text-white font-bold text-[11px]">
              KO
            </div>
            <div className="bg-surface-1 border border-[var(--border)] rounded-xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary inline-block animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-primary inline-block animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-primary inline-block animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="max-w-[85%] px-4 py-3 rounded-xl bg-[var(--status-error-bg)] text-[var(--status-error-fg)] text-sm">
            {error.message}
          </div>
        )}

        {proposal ? (
          <div className="pl-10">
            <ProposalCard
              proposal={proposal}
              brandId={brandId}
              onDone={(outcome, result) => {
                setProposal(null);
                toast[outcome === "confirmed" ? "success" : "message"](
                  outcome === "confirmed"
                    ? "Brand profile updated."
                    : "Dismissed — nothing was changed.",
                );
                /* Gate on completion, not on `confirmed`: a partial capture
                   leaves the brand short of the required fields, and /brand
                   bounces anything incomplete straight back to onboarding. */
                if (result?.brandCompleted && result.snapshot) {
                  /* The snapshot replaces the chat in place rather than
                     navigating: the user chooses where to go next from the
                     card's own buttons. */
                  router.refresh();
                  setVisualStep(result.snapshot);
                }
              }}
            />
          </div>
        ) : (
          <div className="pl-10">
            <Button
              variant="default"
              size="lg"
              loading={extracting}
              loadingText="Capturing…"
              onClick={handleFillProfile}
              aria-label="Fill my brand profile"
            >
              <Sparkles aria-hidden="true" />
              Fill my brand profile
            </Button>
            {extractError && (
              <p className="mt-2 text-[13px] text-[var(--status-error-fg)]">
                {extractError}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 px-4 pb-4 pt-2 bg-background border-t border-[rgba(255,255,255,0.06)]">
        <div className="flex items-end gap-2 bg-surface-1 rounded-2xl px-4 py-3 border border-[rgba(255,255,255,0.08)]">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Tell KO about your brand…"
            rows={1}
            aria-label="Message input"
            className="flex-1 min-h-[40px] max-h-[160px] resize-none border-0 bg-transparent py-1 focus-visible:ring-0"
          />

          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop generating"
              className="w-9 h-9 rounded-full bg-[rgba(255,255,255,0.1)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.15)] transition-colors shrink-0"
            >
              <Square className="w-4 h-4 text-foreground" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
              className="w-9 h-9 rounded-full bg-primary flex items-center justify-center hover:bg-[var(--primary-hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors shrink-0"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-1.5 px-1">
          AI can make mistakes — review responses carefully.
        </p>
      </div>
    </div>
  );
}
