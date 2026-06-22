"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import type { Strategy } from "@/lib/ai/strategy-schema";
import { markStrategyActive } from "./actions";
import { ChatInput } from "./chat-input";
import { MessageList } from "./message-list";
import { PromptChips } from "./prompt-chips";
import { StrategyCard } from "./strategy-card";
import { StrategyPanel } from "./strategy-panel";

interface StrategyHistoryItem {
  id: string;
  name: string;
  updatedAt: Date;
}

interface StrategyClientProps {
  brandId: string;
  brandContext: ChatBrandContext;
  brandName: string;
  pastStrategies?: StrategyHistoryItem[];
}

export function StrategyClient({
  brandId,
  brandContext,
  brandName,
  pastStrategies = [],
}: StrategyClientProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [buildPending, setBuildPending] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [calendarPending, setCalendarPending] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { brandContext },
      }),
    [brandContext],
  );

  const {
    messages,
    status,
    sendMessage,
    stop,
    error,
    regenerate,
    setMessages,
  } = useChat({ transport });

  const isLoading = status === "submitted" || status === "streaming";

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage({ text }, { body: { brandContext } });
    setInput("");
  };

  const handlePickChip = (text: string) => {
    sendMessage({ text }, { body: { brandContext } });
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
    setMessages([]);
    setStrategy(null);
    setStrategyId(null);
    setBuildError(null);
  };

  const showBuildButton = messages.length >= 2 && !strategy && !isLoading;

  return (
    <div className="h-[calc(100vh-56px)] flex overflow-hidden -m-6">
      {/* Left history panel — desktop only */}
      <aside className="hidden lg:flex w-[280px] flex-col border-r border-[rgba(255,255,255,0.06)] overflow-hidden">
        <div className="px-4 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <Button
            variant="secondary"
            onClick={handleNewStrategy}
            className="w-full justify-center"
          >
            New Strategy
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {pastStrategies.length === 0 ? (
            <p className="text-[13px] text-[var(--text-secondary)] px-2 py-3">
              No strategies yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {pastStrategies.map((s) => (
                <li key={s.id}>
                  <div className="px-3 py-2 rounded-lg hover:bg-[rgba(255,255,255,0.04)] cursor-default">
                    <p className="text-[13px] text-foreground truncate">
                      {s.name}
                    </p>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      {new Date(s.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Empty state */}
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div className="w-14 h-14 rounded-full bg-[rgba(19,139,200,0.2)] flex items-center justify-center mb-5 text-primary font-bold text-xl">
              K
            </div>
            <h2 className="text-[24px] font-semibold text-foreground mb-2">
              What are you working on?
            </h2>
            <p className="text-[var(--text-secondary)] max-w-md text-[15px]">
              Tell me about your campaign, product, or goal and I&apos;ll build
              a content strategy for you.
            </p>
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

        {/* Strategy card — mobile fallback (right panel is desktop-only) */}
        {strategy && (
          <div className="flex flex-col gap-2 px-4 pb-4 lg:hidden">
            <StrategyCard
              strategy={strategy}
              generating={calendarPending}
              onEdit={() => setStrategy(null)}
              onGenerateCalendar={handleGenerateCalendar}
            />
            {calendarError && (
              <p className="rounded-xl bg-[var(--status-error-bg)] px-4 py-2 text-sm text-[var(--status-error-fg)]">
                {calendarError}
              </p>
            )}
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
                disabled={buildPending}
                aria-label="Build strategy from conversation"
                className="self-start"
              >
                {buildPending ? "Building…" : `Build Strategy for ${brandName}`}
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

      {/* Right strategy-preview panel (collapsible) */}
      {strategy && (
        <StrategyPanel
          strategy={strategy}
          collapsed={panelCollapsed}
          onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
          onEdit={() => setStrategy(null)}
          onGenerateCalendar={handleGenerateCalendar}
          generating={calendarPending}
          calendarError={calendarError}
        />
      )}
    </div>
  );
}
