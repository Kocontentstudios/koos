"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { PanelRight, PanelsTopLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import type { Strategy } from "@/lib/ai/strategy-schema";
import { cn } from "@/lib/utils";
import { loadStrategy, markStrategyActive } from "./actions";
import { ChatInput } from "./chat-input";
import { MessageList } from "./message-list";
import { PromptChips } from "./prompt-chips";
import { StrategyHistory, type StrategyHistoryItem } from "./strategy-history";
import { StrategyPanel } from "./strategy-panel";

interface StrategyClientProps {
  brandId: string;
  brandContext: ChatBrandContext;
  brandName: string;
  pastStrategies?: StrategyHistoryItem[];
  initialMessages?: UIMessage[];
  initialConversationId?: string | null;
}

export function StrategyClient({
  brandId,
  brandContext,
  brandName,
  pastStrategies = [],
  initialMessages = [],
  initialConversationId = null,
}: StrategyClientProps) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string>(
    () => initialConversationId ?? crypto.randomUUID(),
  );
  const [input, setInput] = useState("");
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [buildPending, setBuildPending] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [calendarPending, setCalendarPending] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Mobile-only drawer state for the history and summary panels (below `lg`).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [loadingStrategyId, setLoadingStrategyId] = useState<string | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { brandContext, brandId, conversationId },
      }),
    [brandContext, brandId, conversationId],
  );

  const {
    messages,
    status,
    sendMessage,
    stop,
    error,
    regenerate,
    setMessages,
  } = useChat({ transport, messages: initialMessages });

  const isLoading = status === "submitted" || status === "streaming";

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage({ text }, { body: { brandContext, brandId, conversationId } });
    setInput("");
  };

  const handlePickChip = (text: string) => {
    sendMessage({ text }, { body: { brandContext, brandId, conversationId } });
  };

  const handleBuildStrategy = async () => {
    setBuildPending(true);
    setBuildError(null);
    const conversation = messages
      .map((m) => {
        const text =
          m.parts
            ?.filter(
              (p): p is Extract<(typeof m.parts)[number], { type: "text" }> =>
                p.type === "text",
            )
            .map((p) => p.text)
            .join("") ?? "";
        return `${m.role}: ${text}`;
      })
      .join("\n\n");

    try {
      const res = await fetch("/api/strategy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, conversation }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Strategy generation failed");
      }
      const data = (await res.json()) as {
        strategy: Strategy;
        strategyId: string;
      };
      setStrategy(data.strategy);
      setStrategyId(data.strategyId);
      setPanelCollapsed(false);
      setSummaryOpen(true);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setBuildPending(false);
    }
  };

  const handleGenerateCalendar = async () => {
    if (!strategyId) return;
    setCalendarPending(true);
    setCalendarError(null);
    try {
      await markStrategyActive(strategyId);
      const res = await fetch("/api/calendar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Calendar generation failed");
      }
      router.push("/calendar");
    } catch (err) {
      setCalendarError(
        err instanceof Error ? err.message : "An error occurred",
      );
      setCalendarPending(false);
    }
  };

  const handleNewStrategy = () => {
    setConversationId(crypto.randomUUID());
    setMessages([]);
    setStrategy(null);
    setStrategyId(null);
    setBuildError(null);
    setLoadError(null);
    setHistoryOpen(false);
  };

  // Load a saved strategy into the summary/card and seed the chat with a recap
  // so the user can keep refining it and rebuild.
  const handleSelectStrategy = async (id: string) => {
    if (loadingStrategyId) return;
    setLoadError(null);
    setLoadingStrategyId(id);
    try {
      const res = await loadStrategy(id);
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      const s = res.strategy;
      setStrategy(s);
      setStrategyId(id);
      const recap = [
        `I've loaded your saved strategy "${s.campaignName}".`,
        "",
        `Objective: ${s.objective}`,
        `Key message: ${s.keyMessage}`,
        `Channels: ${s.channels.map((c) => c.name).join(", ")}`,
        "",
        "Tell me what you'd like to change and I'll refine it, then you can rebuild the strategy.",
      ].join("\n");
      setMessages([
        {
          id: `loaded-${id}`,
          role: "assistant",
          parts: [{ type: "text", text: recap }],
        },
      ]);
      setPanelCollapsed(false);
      setSummaryOpen(true);
      setHistoryOpen(false);
    } catch {
      setLoadError("Could not load strategy.");
    } finally {
      setLoadingStrategyId(null);
    }
  };

  const showBuildButton = messages.length >= 2 && !strategy && !isLoading;

  return (
    <div className="h-[calc(100vh-56px)] flex overflow-hidden -mx-4 -my-6 md:-mx-8 md:-my-8">
      {/* Left history panel — desktop only */}
      <aside className="hidden lg:flex w-[280px] flex-col border-r border-[var(--border)] bg-surface-1 overflow-hidden">
        <StrategyHistory
          pastStrategies={pastStrategies}
          activeId={strategyId}
          loadingId={loadingStrategyId}
          onSelect={handleSelectStrategy}
          onNew={handleNewStrategy}
        />
      </aside>

      {/* Mobile history drawer + backdrop (below lg) */}
      {historyOpen && (
        <button
          type="button"
          aria-label="Close history"
          onClick={() => setHistoryOpen(false)}
          className="fixed inset-0 z-40 bg-[var(--backdrop)] lg:hidden"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-[var(--border)] bg-surface-1 transition-transform duration-200 lg:hidden",
          historyOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <StrategyHistory
          pastStrategies={pastStrategies}
          activeId={strategyId}
          loadingId={loadingStrategyId}
          onSelect={handleSelectStrategy}
          onNew={handleNewStrategy}
          onClose={() => setHistoryOpen(false)}
        />
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile toolbar — opens the history / summary drawers (below lg) */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2 lg:hidden">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSummaryOpen(false);
              setHistoryOpen(true);
            }}
          >
            <PanelsTopLeft className="size-4" />
            History
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setHistoryOpen(false);
              setSummaryOpen(true);
            }}
          >
            Summary
            <PanelRight className="size-4" />
          </Button>
        </div>

        {/* Load error */}
        {loadError && (
          <div className="mx-4 mt-3 rounded-xl bg-[var(--status-error-bg)] px-4 py-2 text-sm text-[var(--status-error-fg)]">
            {loadError}
          </div>
        )}

        {/* Empty state — KO welcome bubble + indented prompt chips */}
        {messages.length === 0 && (
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="flex items-start gap-3 max-w-[85%]">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 text-white font-bold text-[11px]">
                KO
              </div>
              <div className="rounded-xl rounded-tl-sm border border-[var(--border)] bg-surface-1 px-4 py-3 text-sm leading-relaxed text-foreground">
                Hi! I&apos;m KO, your content strategist. Tell me about your
                campaign, product, or goal and I&apos;ll build a content
                strategy for you. Pick one to get started, or describe it in
                your own words.
              </div>
            </div>
            <PromptChips onPick={handlePickChip} />
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <MessageList messages={messages} isLoading={isLoading} />
        )}

        {/* Error from useChat */}
        {error && (
          <div className="mx-4 mb-3 px-4 py-3 rounded-xl bg-[var(--status-error-bg)] text-[var(--status-error-fg)] text-sm flex items-center justify-between gap-3">
            <span>{error.message}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => regenerate()}
              aria-label="Try again"
            >
              Try Again
            </Button>
          </div>
        )}

        {/* Build strategy + build error */}
        {(showBuildButton || buildError) && (
          <div className="px-4 pb-3 flex flex-col gap-2">
            {buildError && (
              <div className="px-4 py-2 rounded-xl bg-[var(--status-error-bg)] text-[var(--status-error-fg)] text-sm flex items-center justify-between gap-3">
                <span>{buildError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleBuildStrategy}
                  aria-label="Retry build strategy"
                >
                  Retry
                </Button>
              </div>
            )}
            {showBuildButton && (
              <Button
                variant="default"
                onClick={handleBuildStrategy}
                loading={buildPending}
                loadingText="Building…"
                aria-label="Build strategy from conversation"
                className="self-start"
              >
                {`Build Strategy for ${brandName}`}
              </Button>
            )}
          </div>
        )}

        {/* Chat input */}
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={stop}
          isLoading={isLoading}
        />
      </div>

      {/* Right strategy-summary panel — the single strategy surface (collapsible) */}
      <StrategyPanel
        strategy={strategy}
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
        onGenerateCalendar={handleGenerateCalendar}
        onEdit={() => {
          setStrategy(null);
          setSummaryOpen(false);
        }}
        generating={calendarPending}
        calendarError={calendarError}
        mobileOpen={summaryOpen}
        onMobileClose={() => setSummaryOpen(false)}
      />
    </div>
  );
}
