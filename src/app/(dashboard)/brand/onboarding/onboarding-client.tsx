"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { Mic, MicOff, Send, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ProposalCard } from "@/components/ai/proposal-card";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceIo } from "@/hooks/use-voice-io";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import type { Proposal } from "@/lib/ai/tools/proposals";

interface OnboardingClientProps {
  brandId: string;
  brandContext: ChatBrandContext;
}

function messageText(msg: UIMessage): string {
  return (
    msg.parts
      ?.filter(
        (p): p is Extract<typeof p, { type: "text" }> => p.type === "text",
      )
      .map((p) => p.text)
      .join("") ?? ""
  );
}

export function OnboardingClient({
  brandId,
  brandContext,
}: OnboardingClientProps) {
  const conversationId = useState(() => crypto.randomUUID())[0];
  const [input, setInput] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const voice = useVoiceIo();
  // Once the user has engaged voice mode, keep speaking replies aloud even
  // after they stop talking — that's the expected back-and-forth for a
  // "voice mode", not just live transcription of the mic.
  const voiceModeRef = useRef(false);

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

  useEffect(() => {
    if (voice.listening) setInput(voice.transcript);
  }, [voice.listening, voice.transcript]);

  // Speak the assistant's latest reply once it finishes streaming, but only
  // for a session where the user has actually used voice mode.
  const lastAssistantText = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const spokenIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceModeRef.current || isLoading || !lastAssistantText) return;
    if (spokenIdRef.current === lastAssistantText.id) return;
    spokenIdRef.current = lastAssistantText.id;
    voice.speak(messageText(lastAssistantText));
    // voice.speak is memoized with useCallback([]) in useVoiceIo, so its
    // reference is stable and including it here doesn't add extra re-runs.
  }, [isLoading, lastAssistantText, voice.speak]);

  function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage(
      { text },
      { body: { brandContext, brandId, conversationId, mode: "onboarding" } },
    );
    setInput("");
    if (voice.listening) voice.stop();
  }

  function toggleMic() {
    if (voice.listening) {
      voice.stop();
      return;
    }
    voiceModeRef.current = true;
    voice.start();
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
              <div
                className={`min-w-0 break-words rounded-xl border px-4 py-3 text-sm leading-relaxed text-foreground ${
                  isUser
                    ? "bg-surface-2 border-[var(--border-accent)] rounded-tr-sm whitespace-pre-line"
                    : "bg-surface-1 border-[var(--border)] rounded-tl-sm"
                }`}
              >
                {isUser ? text : <Markdown>{text}</Markdown>}
              </div>
            </div>
          );
        })}

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
              onDone={(outcome) => {
                setProposal(null);
                toast[outcome === "confirmed" ? "success" : "message"](
                  outcome === "confirmed"
                    ? "Brand profile updated."
                    : "Dismissed — nothing was changed.",
                );
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

          {voice.supported && (
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={voice.listening}
              aria-label={
                voice.listening ? "Stop voice input" : "Start voice input"
              }
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                voice.listening
                  ? "bg-primary text-white"
                  : "bg-[rgba(255,255,255,0.1)] text-foreground hover:bg-[rgba(255,255,255,0.15)]"
              }`}
            >
              {voice.listening ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          )}

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
