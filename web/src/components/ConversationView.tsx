"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
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

function roleFromLabel(label: string): "user" | "assistant" {
  const normalized = label.trim().toLowerCase();
  if (["user", "usuario", "usuário", "you", "voce", "você"].includes(normalized)) {
    return "user";
  }
  return "assistant";
}

function parseConversationMarkdown(content: string): ConversationMessage[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
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

  for (const line of lines) {
    const inlineRoleMatch = line.match(
      /^\s*(?:#{1,6}\s*)?(user|usuario|usuário|you|voce|você|assistant|chatgpt|ai|brain2)\s*:\s*(.*)$/i
    );

    if (inlineRoleMatch) {
      flush();
      currentRole = roleFromLabel(inlineRoleMatch[1]);
      const inlineText = inlineRoleMatch[2].trim();
      if (inlineText.length > 0) {
        buffer.push(inlineText);
      }
      continue;
    }

    const roleMarkerOnly = line.match(
      /^\s*(?:#{1,6}\s*)?(user|usuario|usuário|you|voce|você|assistant|chatgpt|ai|brain2)\s*:?\s*$/i
    );

    if (roleMarkerOnly) {
      flush();
      currentRole = roleFromLabel(roleMarkerOnly[1]);
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
        content: content.trim() || "Sem conteúdo nesta conversa.",
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

  return (
    <div className="conversation-root">
      <header className="conversation-header">
        <div className="conversation-headings">
          <h2>{conversation.title}</h2>
          <p>
            {conversation.path} · atualizado em {formatModifiedDate(conversation.modifiedAt)}
          </p>
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
        }

        .message-row {
          display: flex;
          align-items: flex-start;
          gap: 0;
          width: min(860px, 100%);
        }

        .message-row--user {
          margin-left: auto;
        }

        .message-bubble {
          background: transparent;
          border: none;
          padding: 0;
          max-width: min(760px, 100%);
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
