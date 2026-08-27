"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speechText } from "@/lib/speech/speech-text";

// The DOM lib doesn't ship SpeechRecognition types; shim the narrow surface
// this hook actually uses instead of reaching for `any`.
interface SpeechRecognitionResultLike {
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function getSynthesis(): SpeechSynthesis | undefined {
  if (typeof window === "undefined") return undefined;
  return window.speechSynthesis ?? undefined;
}

/** Identifies an utterance started without a caller-supplied id. */
const ANONYMOUS = "__speaking__";

export interface UseVoiceIo {
  supported: boolean;
  listening: boolean;
  transcript: string;
  start: () => void;
  stop: () => void;
  /** Speaks `text`, cancelling anything already in flight. */
  speak: (text: string, id?: string) => void;
  cancel: () => void;
  /** Id passed to `speak`, or null when nothing is being spoken. */
  speakingId: string | null;
  speaking: boolean;
}

export function useVoiceIo(): UseVoiceIo {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== undefined);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const cancel = useCallback(() => {
    // Drop the reference first: cancel() fires `end` on the utterance being
    // killed, and that handler must not clear state belonging to a newer one.
    utteranceRef.current = null;
    getSynthesis()?.cancel();
    setSpeakingId(null);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      // Speech otherwise keeps talking after the user has navigated away.
      utteranceRef.current = null;
      getSynthesis()?.cancel();
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || recognitionRef.current) return;

    setTranscript("");
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const spoken = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ");
      setTranscript(spoken);
    };
    recognition.onerror = () => {
      recognitionRef.current = null; // clear the dead instance so start() can create a fresh one
      setListening(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null; // clear the dead instance so start() can create a fresh one
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const speak = useCallback(
    (text: string, id?: string) => {
      const synthesis = getSynthesis();
      if (!synthesis) return;

      cancel();

      // Markdown and emoji reach the voice verbatim otherwise — asterisks and
      // CLDR emoji names get read out mid-sentence.
      const spoken = speechText(text);
      if (!spoken) return;

      const utterance = new SpeechSynthesisUtterance(spoken);
      const settle = () => {
        if (utteranceRef.current !== utterance) return;
        utteranceRef.current = null;
        setSpeakingId(null);
      };
      utterance.onend = settle;
      utterance.onerror = settle;

      utteranceRef.current = utterance;
      setSpeakingId(id ?? ANONYMOUS);
      synthesis.speak(utterance);
    },
    [cancel],
  );

  return {
    supported,
    listening,
    transcript,
    start,
    stop,
    speak,
    cancel,
    speakingId,
    speaking: speakingId !== null,
  };
}
