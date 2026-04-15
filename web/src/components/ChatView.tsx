"use client";

import { useCallback, useEffect, useRef, useState, type UIEvent, type WheelEvent } from "react";
import { Check, Copy, ScrollText, Square, Volume2, X } from "lucide-react";
import type { ChatMessage } from "@/lib/chat";
import {
  isBrowserSpeechSynthesisAvailable,
  speakBrowserText,
} from "@/lib/browserSpeechSynthesis";
import { loadLlmConfig } from "@/lib/llmClientConfig";
import {
  cancelAllAssistantSpeech,
  playOpenAiSpeech,
  readOpenAiTtsOutputEnabled,
} from "@/lib/openAiSpeech";

type ChatViewProps = {
  title: string;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  /** Limpa o erro do chat (botão «Dispensar»). */
  onDismissChatError?: () => void;
  /** Caminhos de notas usadas na última resposta — feedback ANCC. */
  vaultFeedbackPaths?: string[];
  onVaultMemoryFeedback?: (helpful: boolean) => void;
};

function roleLabel(role: ChatMessage["role"]): string {
  if (role === "user") return "Você";
  if (role === "assistant") return "Brain";
  return "Sistema";
}

type SpeechTarget =
  | { kind: "reply"; messageId: string }
  | { kind: "conversationThrough"; assistantMessageId: string };

/** Texto legível para TTS a partir de Markdown simples. */
function textForSpeech(markdown: string): string {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[(.+?)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Texto da conversa desde o início até à mensagem do assistente indicada (índice inclusivo). */
function buildConversationSpeechText(messages: ChatMessage[], throughAssistantIndex: number): string {
  const parts: string[] = [];
  for (let i = 0; i <= throughAssistantIndex; i++) {
    const msg = messages[i]!;
    if (msg.role === "system") continue;
    const t = textForSpeech(msg.content);
    if (!t) continue;
    parts.push(`${roleLabel(msg.role)}. ${t}`);
  }
  return parts.join("\n\n");
}

/** Pixels from the bottom to consider the user “following” the stream (auto-scroll). */
const PIN_THRESHOLD_PX = 96;

export default function ChatView({
  title,
  messages,
  loading,
  error,
  onDismissChatError,
  vaultFeedbackPaths = [],
  onVaultMemoryFeedback,
}: ChatViewProps) {
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const followBottomRef = useRef(true);
  const lastMessageKeyRef = useRef<string>("");
  const rafRef = useRef<number>(0);
  const copyTimeoutRef = useRef<number | null>(null);
  const [completedTypingIds, setCompletedTypingIds] = useState<Set<string>>(new Set());
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [speechTarget, setSpeechTarget] = useState<SpeechTarget | null>(null);
  const [browserTts, setBrowserTts] = useState(false);
  const [, bumpOpenAiTtsPrefs] = useState(0);

  useEffect(() => {
    queueMicrotask(() => setBrowserTts(isBrowserSpeechSynthesisAvailable()));
  }, []);

  useEffect(() => {
    const bump = () => bumpOpenAiTtsPrefs((n) => n + 1);
    window.addEventListener("brain2-openai-tts-changed", bump);
    return () => window.removeEventListener("brain2-openai-tts-changed", bump);
  }, []);

  const openAiTtsOn = readOpenAiTtsOutputEnabled();
  const apiKey = loadLlmConfig()?.apiKey?.trim() ?? "";
  const ttsAvailable = browserTts || Boolean(openAiTtsOn && apiKey);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      cancelAllAssistantSpeech();
    };
  }, []);

  const speakOrStopAssistantMessage = useCallback((messageId: string, rawContent: string) => {
    if (!ttsAvailable) {
      return;
    }
    if (speechTarget?.kind === "reply" && speechTarget.messageId === messageId) {
      cancelAllAssistantSpeech();
      setSpeechTarget(null);
      return;
    }
    const text = textForSpeech(rawContent);
    if (!text) {
      return;
    }
    cancelAllAssistantSpeech();
    setSpeechTarget({ kind: "reply", messageId });
    const clearReply = () => {
      setSpeechTarget((current) =>
        current?.kind === "reply" && current.messageId === messageId ? null : current,
      );
    };
    if (readOpenAiTtsOutputEnabled() && apiKey) {
      void playOpenAiSpeech(text, apiKey, {
        onEnd: clearReply,
        onError: () => {
          clearReply();
        },
      });
      return;
    }
    speakBrowserText(text, {
      onEnd: clearReply,
      onError: clearReply,
    });
  }, [ttsAvailable, speechTarget, apiKey]);

  const speakOrStopConversationThroughAssistant = useCallback(
    (assistantMessageId: string) => {
      if (!ttsAvailable) {
        return;
      }
      if (
        speechTarget?.kind === "conversationThrough" &&
        speechTarget.assistantMessageId === assistantMessageId
      ) {
        cancelAllAssistantSpeech();
        setSpeechTarget(null);
        return;
      }
      const idx = messages.findIndex((m) => m.id === assistantMessageId);
      if (idx < 0) {
        return;
      }
      if (messages[idx]!.role !== "assistant") {
        return;
      }
      const text = buildConversationSpeechText(messages, idx);
      if (!text) {
        return;
      }
      cancelAllAssistantSpeech();
      setSpeechTarget({ kind: "conversationThrough", assistantMessageId });
      const clearConv = () => {
        setSpeechTarget((current) =>
          current?.kind === "conversationThrough" && current.assistantMessageId === assistantMessageId
            ? null
            : current,
        );
      };
      if (readOpenAiTtsOutputEnabled() && apiKey) {
        void playOpenAiSpeech(text, apiKey, {
          onEnd: clearConv,
          onError: () => {
            clearConv();
          },
        });
        return;
      }
      speakBrowserText(text, {
        onEnd: clearConv,
        onError: clearConv,
      });
    },
    [ttsAvailable, speechTarget, messages, apiKey],
  );

  const updateFollowFromScrollPosition = useCallback(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const gap = root.scrollHeight - root.scrollTop - root.clientHeight;
    followBottomRef.current = gap <= PIN_THRESHOLD_PX;
  }, []);

  const onScrollRoot = useCallback(
    (_e: UIEvent<HTMLElement>) => {
      updateFollowFromScrollPosition();
    },
    [updateFollowFromScrollPosition]
  );

  const onWheelRoot = useCallback(
    (e: WheelEvent<HTMLElement>) => {
      if (e.deltaY < -1) {
        followBottomRef.current = false;
      }
    },
    []
  );

  const copyMessage = async (messageId: string, content: string) => {
    if (!content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1800);
    } catch {
      setCopiedMessageId(null);
    }
  };

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "assistant") {
      return;
    }

    if (completedTypingIds.has(lastMessage.id)) {
      return;
    }

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    const target = lastMessage.content;
    let index = 0;
    let lastFrame = performance.now();
    let initialized = false;

    const tick = (timestamp: number) => {
      if (!initialized) {
        initialized = true;
        setTypingMessageId(lastMessage.id);
        setTypingText("");
        lastFrame = timestamp;
      }

      const delta = timestamp - lastFrame;
      if (delta < 20) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      lastFrame = timestamp;

      const charsPerSecond =
        target.length > 1200
          ? 260
          : target.length > 600
            ? 210
            : 165;
      const advance = Math.max(1, Math.floor((delta / 1000) * charsPerSecond));

      index = Math.min(target.length, index + advance);
      setTypingText(target.slice(0, index));

      if (index < target.length) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      setCompletedTypingIds((previous) => {
        const next = new Set(previous);
        next.add(lastMessage.id);
        return next;
      });
      setTypingMessageId(null);
      setTypingText("");
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [messages, completedTypingIds]);

  /** Novo envio do utilizador: voltar a seguir o fundo para a resposta animada. */
  useEffect(() => {
    if (messages.length === 0) {
      lastMessageKeyRef.current = "";
      return;
    }
    const last = messages[messages.length - 1];
    const key = `${last.id}:${last.role}`;
    if (key === lastMessageKeyRef.current) {
      return;
    }
    lastMessageKeyRef.current = key;
    if (last.role === "user") {
      followBottomRef.current = true;
    }
  }, [messages]);

  const pendingTypingId = (() => {
    const last = messages[messages.length - 1];
    if (!last) return null;
    if (last.role !== "assistant") return null;
    if (completedTypingIds.has(last.id)) return null;
    return last.id;
  })();

  useEffect(() => {
    if (!followBottomRef.current) {
      return;
    }
    const root = scrollRootRef.current;
    if (!root) {
      return;
    }
    const run = () => {
      if (!followBottomRef.current) {
        return;
      }
      root.scrollTop = root.scrollHeight - root.clientHeight;
    };
    run();
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  }, [messages, loading, typingText]);

  return (
    <div className="chat-root">
      <header className="chat-header">
        <div className="chat-title-wrap">
          <h2>{title}</h2>
          <p>{messages.length} mensagens nesta conversa</p>
        </div>
      </header>

      <section
        ref={scrollRootRef}
        className="chat-scroll"
        aria-label="Conversa do Brain"
        onScroll={onScrollRoot}
        onWheel={onWheelRoot}
      >
        <div className="chat-content-column">
          {messages.length === 0 && !loading && !error && (
            <div className="chat-empty">
              <h3>Comece uma conversa</h3>
              <p>Pergunte qualquer coisa ao Brain2 na barra inferior.</p>
            </div>
          )}

          {messages.map((message) => {
            const isTypingMessage = message.id === typingMessageId || message.id === pendingTypingId;
            const visibleContent = isTypingMessage ? typingText : message.content;

            return (
              <div key={message.id} className={`chat-row chat-row--${message.role}`}>
                <article className={`chat-message chat-message--${message.role}`}>
                  <h4>{roleLabel(message.role)}</h4>
                  <p>
                    {visibleContent}
                    {isTypingMessage && <span className="typing-caret" aria-hidden>|</span>}
                  </p>
                  {message.role === "assistant" && (
                    <div className="message-actions" aria-label="Ações da resposta">
                      <button
                        className="message-action-btn"
                        type="button"
                        onClick={() => copyMessage(message.id, message.content)}
                        aria-label="Copiar resposta"
                        title="Copiar resposta"
                      >
                        {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <button
                        className={`message-action-btn${
                          speechTarget?.kind === "conversationThrough" &&
                          speechTarget.assistantMessageId === message.id
                            ? " message-action-btn--speaking"
                            : ""
                        }`}
                        type="button"
                        aria-label={
                          speechTarget?.kind === "conversationThrough" &&
                          speechTarget.assistantMessageId === message.id
                            ? "Parar leitura da conversa"
                            : "Ler conversa até aqui"
                        }
                        title={
                          ttsAvailable
                            ? speechTarget?.kind === "conversationThrough" &&
                              speechTarget.assistantMessageId === message.id
                              ? "Parar leitura"
                              : "Ler conversa em voz desde o início até esta resposta"
                            : "Síntese de voz não disponível neste browser"
                        }
                        disabled={!ttsAvailable}
                        aria-pressed={
                          speechTarget?.kind === "conversationThrough" &&
                          speechTarget.assistantMessageId === message.id
                        }
                        onClick={() => speakOrStopConversationThroughAssistant(message.id)}
                      >
                        {speechTarget?.kind === "conversationThrough" &&
                        speechTarget.assistantMessageId === message.id ? (
                          <Square size={12} strokeWidth={2.5} />
                        ) : (
                          <ScrollText size={14} />
                        )}
                      </button>
                      <button
                        className={`message-action-btn${
                          speechTarget?.kind === "reply" && speechTarget.messageId === message.id
                            ? " message-action-btn--speaking"
                            : ""
                        }`}
                        type="button"
                        aria-label={
                          speechTarget?.kind === "reply" && speechTarget.messageId === message.id
                            ? "Parar leitura"
                            : "Ouvir resposta"
                        }
                        title={
                          ttsAvailable
                            ? speechTarget?.kind === "reply" && speechTarget.messageId === message.id
                              ? "Parar leitura"
                              : "Ouvir resposta em voz"
                            : "Síntese de voz não disponível neste browser"
                        }
                        disabled={!ttsAvailable}
                        aria-pressed={
                          speechTarget?.kind === "reply" && speechTarget.messageId === message.id
                        }
                        onClick={() => speakOrStopAssistantMessage(message.id, message.content)}
                      >
                        {speechTarget?.kind === "reply" && speechTarget.messageId === message.id ? (
                          <Square size={12} strokeWidth={2.5} />
                        ) : (
                          <Volume2 size={14} />
                        )}
                      </button>
                    </div>
                  )}
                </article>
              </div>
            );
          })}

          {loading && (
            <div className="chat-row chat-row--assistant">
              <article className="chat-message chat-message--assistant">
                <h4>Brain</h4>
                <p>Escrevendo resposta...</p>
              </article>
            </div>
          )}

          {error && (
            <div className="chat-row chat-row--assistant">
              <article className="chat-error-banner" role="alert">
                <p className="chat-error-text">{error}</p>
                {onDismissChatError ? (
                  <button
                    type="button"
                    className="chat-error-dismiss"
                    onClick={onDismissChatError}
                    aria-label="Dispensar mensagem de erro"
                  >
                    <X size={16} strokeWidth={2} aria-hidden />
                  </button>
                ) : null}
              </article>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </section>

      {vaultFeedbackPaths.length > 0 && onVaultMemoryFeedback && !loading ? (
        <div className="chat-vault-feedback" role="group" aria-label="Feedback sobre memória do vault">
          <span className="chat-vault-feedback-label">As notas do vault ajudaram nesta resposta?</span>
          <div className="chat-vault-feedback-actions">
            <button type="button" className="chat-vault-feedback-btn" onClick={() => onVaultMemoryFeedback(true)}>
              Sim
            </button>
            <button type="button" className="chat-vault-feedback-btn chat-vault-feedback-btn--muted" onClick={() => onVaultMemoryFeedback(false)}>
              Não
            </button>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .chat-root {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .chat-header {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 12px;
          padding: 20px 24px 12px;
        }

        .chat-title-wrap {
          min-width: 0;
        }

        .chat-title-wrap h2 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 15px;
          font-weight: 500;
          color: var(--foreground);
        }

        .chat-vault-feedback {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 20px 14px;
          border-top: 1px solid var(--bar-border, rgba(255, 255, 255, 0.08));
          background: rgba(0, 0, 0, 0.15);
        }

        .chat-vault-feedback-label {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--muted, #888);
        }

        .chat-vault-feedback-actions {
          display: flex;
          gap: 8px;
        }

        .chat-vault-feedback-btn {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid var(--bar-border, rgba(255, 255, 255, 0.12));
          background: var(--pill-active, rgba(255, 255, 255, 0.06));
          color: var(--foreground, #e8e8e8);
          cursor: pointer;
        }

        .chat-vault-feedback-btn:hover {
          opacity: 0.92;
        }

        .chat-vault-feedback-btn--muted {
          opacity: 0.75;
        }

        .chat-title-wrap p {
          margin: 4px 0 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #666;
        }

        .chat-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-anchor: none;
          padding: 8px clamp(16px, 4vw, 40px) 170px;
          user-select: text;
          -webkit-user-select: text;
          -webkit-touch-callout: default;
        }

        .chat-content-column {
          max-width: 950px;
          width: 100%;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .chat-empty h3 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: var(--foreground);
        }

        .chat-empty p {
          margin: 6px 0 0;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: #666;
        }

        .chat-row {
          width: 100%;
          display: flex;
          justify-content: flex-start;
        }

        .chat-row--user {
          justify-content: flex-end;
        }

        .chat-message {
          width: 100%;
          max-width: 100%;
          display: flex;
          flex-direction: column;
          gap: 6px;
          text-align: left;
        }

        .chat-message--user {
          text-align: right;
        }

        .chat-message h4 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #6e6e6e;
          font-weight: 500;
        }

        .chat-message p {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          line-height: 1.7;
          color: var(--foreground);
          white-space: pre-wrap;
          word-break: break-word;
          user-select: text;
          -webkit-user-select: text;
          cursor: text;
        }

        /* Texto do utilizador na conversa: mais suave (só exibição; InputBar não usa estas classes). */
        .chat-message--user p {
          color: var(--muted);
          font-style: italic;
          opacity: 0.92;
        }

        .message-actions {
          margin-top: 2px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .chat-message--user .message-actions {
          justify-content: flex-end;
        }

        .message-action-btn {
          width: 26px;
          height: 26px;
          border: 1px solid transparent;
          border-radius: 7px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: #767676;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .message-action-btn:hover {
          background: rgba(0, 0, 0, 0.04);
          border-color: rgba(0, 0, 0, 0.08);
          color: #3e3e3e;
        }

        .message-action-btn--speaking {
          color: #2a6ea8;
          border-color: rgba(42, 110, 168, 0.35);
          background: rgba(42, 110, 168, 0.1);
        }

        .message-action-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .message-action-btn--disabled,
        .message-action-btn--disabled:hover {
          opacity: 0.45;
          cursor: default;
          background: transparent;
          border-color: transparent;
        }

        .typing-caret {
          margin-left: 2px;
          color: #777;
          animation: caret-blink 0.9s step-end infinite;
        }

        @keyframes caret-blink {
          0%, 45% {
            opacity: 1;
          }
          50%, 100% {
            opacity: 0;
          }
        }

        .chat-error-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          width: 100%;
          max-width: 100%;
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(180, 60, 60, 0.12);
          border: 1px solid rgba(200, 90, 90, 0.35);
        }

        .chat-error-text {
          flex: 1;
          margin: 0;
          min-width: 0;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          line-height: 1.45;
          color: #e8a0a0;
        }

        .chat-error-dismiss {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          margin: -4px -4px -4px 0;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: #c88888;
          cursor: pointer;
        }

        .chat-error-dismiss:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #e8b0b0;
        }

        @media (max-width: 979px) {
          .chat-header {
            padding: 16px 14px 10px;
          }

          .chat-scroll {
            padding: 8px clamp(14px, 4vw, 24px) 160px;
          }
        }
      `}</style>
    </div>
  );
}
