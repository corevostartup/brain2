"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Volume2, X } from "lucide-react";
import type { VaultConversation } from "@/lib/vault";

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ConversationViewProps = {
  conversation: VaultConversation;
  onClose: () => void;
};

function formatConversationHeaderTitle(rawTitle: string): string {
  const withoutMetadata = rawTitle.replace(/\s+-\s*\([^)]*\)\s*$/, "").trim();
  return withoutMetadata || "Conversa";
}

function roleFromLabel(label: string): "user" | "assistant" {
  const normalized = label.trim().toLowerCase();
  if (["user", "utilizador", "usuario", "usuário", "you", "voce", "você"].includes(normalized)) {
    return "user";
  }
  return "assistant";
}

function stripLeadingFrontmatter(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return content;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      return lines.slice(index + 1).join("\n");
    }
  }

  return content;
}

function parseRoleMarker(line: string): {
  role: "user" | "assistant";
  inlineText: string;
} | null {
  const timestampHeadingMatch = line.match(
    /^\s*#{1,6}\s*(user|utilizador|usuario|usuário|you|voce|você|assistant|chatgpt|ai|brain2|brain)\b\s*[—–-]\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*$/i
  );

  if (timestampHeadingMatch) {
    return {
      role: roleFromLabel(timestampHeadingMatch[1]),
      inlineText: "",
    };
  }

  const markerMatch = line.match(
    /^\s*(#{1,6}\s*)?(user|utilizador|usuario|usuário|you|voce|você|assistant|chatgpt|ai|brain2|brain)\b(?:\s*([:\-–—])\s*(.*))?\s*$/i
  );

  if (!markerMatch) {
    return null;
  }

  const hasHeadingPrefix = Boolean(markerMatch[1]);
  const role = roleFromLabel(markerMatch[2]);
  const separator = markerMatch[3] ?? "";
  const tail = (markerMatch[4] ?? "").trim();

  const inlineText = (!hasHeadingPrefix && separator === ":" && tail.length > 0) ? tail : "";

  return { role, inlineText };
}

function parseConversationMarkdown(content: string): ConversationMessage[] {
  const sanitizedContent = stripLeadingFrontmatter(content);
  const lines = sanitizedContent.replace(/\r\n/g, "\n").split("\n");
  const messages: ConversationMessage[] = [];
  let currentRole: "user" | "assistant" = "assistant";
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text.length > 0) {
      messages.push({
        id: `${messages.length + 1}`,
        role: currentRole,
        content: text,
      });
    }
    buffer = [];
  };

  const firstRoleLine = lines.findIndex((line) => parseRoleMarker(line) !== null);

  if (firstRoleLine === -1) {
    const fallback = sanitizedContent.trim();
    if (fallback.length > 0) {
      return [
        {
          id: "fallback-1",
          role: "assistant",
          content: fallback,
        },
      ];
    }

    return [
      {
        id: "fallback-1",
        role: "assistant",
        content: "Sem conteúdo nesta conversa.",
      },
    ];
  }

  for (let index = firstRoleLine; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = parseRoleMarker(line);

    if (marker) {
      flush();
      currentRole = marker.role;
      if (marker.inlineText.length > 0) {
        buffer.push(marker.inlineText);
      }
      continue;
    }

    buffer.push(line);
  }

  flush();

  if (messages.length === 0) {
    return [
      {
        id: "fallback-1",
        role: "assistant",
        content: "Sem conteúdo nesta conversa.",
      },
    ];
  }

  return messages;
}

function formatModifiedDate(timestamp: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function ConversationView({ conversation, onClose }: ConversationViewProps) {
  const messages = useMemo(
    () => parseConversationMarkdown(conversation.content),
    [conversation.content]
  );
  const displayTitle = useMemo(
    () => formatConversationHeaderTitle(conversation.title),
    [conversation.title]
  );
  const copyTimeoutRef = useRef<number | null>(null);
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

  return (
    <div className="conversation-root">
      <header className="conversation-header">
        <div className="conversation-headings">
          <h2>{displayTitle}</h2>
          <p>Atualizado em {formatModifiedDate(conversation.modifiedAt)}</p>
        </div>
        <button className="conversation-close" type="button" onClick={onClose}>
          <X size={15} strokeWidth={2} />
          Fechar
        </button>
      </header>

      <div className="messages-scroll" role="log" aria-label="Mensagens da conversa">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message-row${message.role === "user" ? " message-row--user" : ""}`}
          >
            <article
              className={`message-bubble${message.role === "user" ? " message-bubble--user" : ""}`}
            >
              <p>{message.content}</p>
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
          </div>
        ))}
      </div>

      <style jsx>{`
        .conversation-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;
          background: var(--background);
        }

        .conversation-header {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: center;
          padding: 18px 24px 14px;
        }

        .conversation-headings {
          min-width: 0;
        }

        .conversation-headings h2 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .conversation-headings p {
          margin: 3px 0 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #5f5f5f;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .conversation-close {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 32px;
          padding: 0 11px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: transparent;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          transition: background 0.15s ease, color 0.15s ease;
          flex-shrink: 0;
        }

        .conversation-close:hover {
          background: var(--pill-active);
          color: var(--muted-hover);
        }

        .messages-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 28px 24px 180px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          user-select: text;
          -webkit-user-select: text;
          -webkit-touch-callout: default;
        }

        .message-row {
          display: flex;
          align-items: flex-start;
          gap: 0;
          width: 100%;
          justify-content: flex-start;
        }

        .message-row--user {
          justify-content: flex-end;
        }

        .message-bubble {
          background: transparent;
          border: none;
          padding: 0;
          width: min(760px, 100%);
          text-align: left;
        }

        .message-bubble--user {
          text-align: right;
        }

        .message-bubble p {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          line-height: 1.65;
          color: var(--foreground);
          white-space: pre-wrap;
          word-break: break-word;
          user-select: text;
          -webkit-user-select: text;
          cursor: text;
        }

        .message-actions {
          margin-top: 4px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .message-row--user .message-actions {
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

        @media (max-width: 979px) {
          .conversation-header {
            padding: 16px 16px 12px;
          }

          .messages-scroll {
            padding: 18px 14px 170px;
          }
        }
      `}</style>
    </div>
  );
}
