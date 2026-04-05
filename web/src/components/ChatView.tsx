"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Volume2 } from "lucide-react";
import type { ChatMessage } from "@/lib/chat";

type ChatViewProps = {
  title: string;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
};

function roleLabel(role: ChatMessage["role"]): string {
  if (role === "user") return "Você";
  if (role === "assistant") return "Brain";
  return "Sistema";
}

export default function ChatView({ title, messages, loading, error }: ChatViewProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const copyTimeoutRef = useRef<number | null>(null);
  const [completedTypingIds, setCompletedTypingIds] = useState<Set<string>>(new Set());
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

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
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

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

  const pendingTypingId = (() => {
    const last = messages[messages.length - 1];
    if (!last) return null;
    if (last.role !== "assistant") return null;
    if (completedTypingIds.has(last.id)) return null;
    return last.id;
  })();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, typingText]);

  return (
    <div className="chat-root">
      <header className="chat-header">
        <div className="chat-title-wrap">
          <h2>{title}</h2>
          <p>{messages.length} mensagens nesta conversa</p>
        </div>
      </header>

      <section className="chat-scroll" aria-label="Conversa do Brain">
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
            <article
              key={message.id}
              className={`chat-message chat-message--${message.role}`}
            >
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
                    className="message-action-btn message-action-btn--disabled"
                    type="button"
                    aria-label="Ouvir resposta (em breve)"
                    title="Ouvir resposta (em breve)"
                    disabled
                  >
                    <Volume2 size={14} />
                  </button>
                </div>
              )}
            </article>
          );
        })}

        {loading && (
          <article className="chat-message chat-message--assistant">
            <h4>Brain</h4>
            <p>Escrevendo resposta...</p>
          </article>
        )}

        {error && (
          <article className="chat-error" role="alert">
            {error}
          </article>
        )}

        <div ref={endRef} />
      </section>

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
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 8px 24px 170px;
          user-select: text;
          -webkit-user-select: text;
          -webkit-touch-callout: default;
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

        .chat-message {
          width: min(840px, 100%);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .chat-message--user {
          align-self: flex-end;
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

        .chat-error {
          width: min(840px, 100%);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: #d97a7a;
        }

        @media (max-width: 979px) {
          .chat-header {
            padding: 16px 14px 10px;
          }

          .chat-scroll {
            padding: 8px 14px 160px;
          }
        }
      `}</style>
    </div>
  );
}
