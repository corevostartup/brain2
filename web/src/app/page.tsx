"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import InputBar from "@/components/InputBar";
import DesktopSidebar from "@/components/DesktopSidebar";
import BrainGraphView from "@/components/BrainGraphView";
import ConversationView from "@/components/ConversationView";
import ChatView from "@/components/ChatView";
import SettingsView from "@/components/SettingsView";
import { PanelLeftOpen } from "lucide-react";
import {
  type VaultConversation,
  type VaultGraph,
  type FolderTreeNode,
} from "@/lib/vault";
import type { ChatMessage } from "@/lib/chat";

type PresetVaultResponse = {
  path: string;
  folders: FolderTreeNode[];
  graph: VaultGraph;
  conversations: VaultConversation[];
};

type NativeVaultPayload = {
  path?: string;
  folders?: FolderTreeNode[];
  graph?: VaultGraph | null;
  conversations?: VaultConversation[];
};

type NativeBridge = {
  isAvailable?: boolean;
  pickDirectory?: () => void;
  saveConversation?: (payload: {
    conversationId: string;
    title: string;
    markdown: string;
  }) => void;
};

function toIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function buildChatTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) {
    return "Brain2 Conversation";
  }
  const compact = firstUser.content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Brain2 Conversation";
  }
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
}

function buildChatMarkdown(params: {
  title: string;
  startedAt: number;
  model: string;
  messages: ChatMessage[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${params.title}`);
  lines.push("");
  lines.push(`- Created: ${toIsoDate(params.startedAt)}`);
  lines.push(`- Updated: ${toIsoDate(Date.now())}`);
  lines.push(`- Model: ${params.model}`);
  lines.push("");

  for (const message of params.messages) {
    if (message.role === "system") {
      continue;
    }

    lines.push(`## ${message.role === "user" ? "User" : "Brain"}`);
    lines.push("");
    lines.push(message.content.trim());
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function sanitizeFileName(raw: string): string {
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "conversation";
}

function parseWikilinks(content: string): string[] {
  const regex = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const target = match[1]?.trim();
    if (target) {
      links.push(target);
    }
  }

  return links;
}

function buildGraphFromConversations(conversations: VaultConversation[]): VaultGraph {
  const nodeMap = new Map<string, string>();

  for (const conversation of conversations) {
    const title = conversation.title.trim();
    if (!title) continue;
    nodeMap.set(title.toLowerCase(), title);
  }

  const nodes = Array.from(nodeMap.entries()).map(([id, label]) => ({ id, label }));
  const edges: Array<{ source: string; target: string }> = [];
  const edgeSet = new Set<string>();

  for (const conversation of conversations) {
    const sourceTitle = conversation.title.trim();
    if (!sourceTitle) continue;
    const sourceId = sourceTitle.toLowerCase();
    const links = parseWikilinks(conversation.content || "");

    for (const link of links) {
      const targetId = link.toLowerCase();
      if (!nodeMap.has(targetId)) {
        nodeMap.set(targetId, link);
        nodes.push({ id: targetId, label: link });
      }

      if (sourceId === targetId) {
        continue;
      }

      const edgeKey = sourceId < targetId
        ? `${sourceId}::${targetId}`
        : `${targetId}::${sourceId}`;

      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({ source: sourceId, target: targetId });
      }
    }
  }

  return { nodes, edges };
}

function normalizeGraph(
  graph: VaultGraph | null | undefined,
  conversations: VaultConversation[]
): VaultGraph | null {
  const hasValidGraph = Boolean(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges));
  if (hasValidGraph && (graph?.nodes.length ?? 0) > 0) {
    return graph ?? null;
  }

  if (conversations.length === 0) {
    return hasValidGraph ? (graph ?? null) : null;
  }

  return buildGraphFromConversations(conversations);
}

export default function Home() {
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isYourBrainOpen, setIsYourBrainOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [vaultGraph, setVaultGraph] = useState<VaultGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [vaultFolders, setVaultFolders] = useState<FolderTreeNode[]>([]);
  const [vaultConversations, setVaultConversations] = useState<VaultConversation[]>([]);
  const [vaultPath, setVaultPath] = useState("");
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [returnToYourBrainOnConversationClose, setReturnToYourBrainOnConversationClose] = useState(false);
  const [hasNativeVaultData, setHasNativeVaultData] = useState(false);
  const [vaultDataVersion, setVaultDataVersion] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatSessionStartedAt, setChatSessionStartedAt] = useState<number | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const selectedConversation = useMemo(
    () => vaultConversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [selectedConversationId, vaultConversations]
  );

  const chatTitle = useMemo(() => {
    if (chatMessages.length === 0) {
      return "Nova conversa";
    }
    return buildChatTitle(chatMessages);
  }, [chatMessages]);

  const activeView = isSettingsOpen
    ? "settings"
    : isYourBrainOpen
      ? "brain"
      : selectedConversation
        ? "conversation"
        : isChatOpen || chatMessages.length > 0 || chatLoading || Boolean(chatError)
          ? "chat"
        : "home";

  const createMessageId = useCallback(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, []);

  const applyVaultData = useCallback((
    data: {
      path?: string;
      folders?: FolderTreeNode[];
      graph?: VaultGraph | null;
      conversations?: VaultConversation[];
    },
    options?: { markAsNative?: boolean }
  ) => {
    const nextConversations = data.conversations ?? [];
    const nextGraph = normalizeGraph(data.graph, nextConversations);

    setHasNativeVaultData(Boolean(options?.markAsNative));
    setVaultPath(data.path ?? "");
    setVaultFolders(data.folders ?? []);
    setVaultGraph(nextGraph);
    setVaultConversations(nextConversations);
    setSelectedFolderPath(null);
    setSelectedConversationId(null);
    setReturnToYourBrainOnConversationClose(false);
    setGraphLoading(false);
    setVaultDataVersion((value) => value + 1);
  }, []);

  const loadPresetVaultData = useCallback(async (options?: { force?: boolean }) => {
    if (hasNativeVaultData && !options?.force) {
      return;
    }

    setGraphLoading(true);
    try {
      const response = await fetch("/api/vault", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Falha ao carregar vault preset");
      }
      const data = (await response.json()) as PresetVaultResponse;
      applyVaultData(
        {
          path: data.path,
          folders: data.folders,
          graph: data.graph,
          conversations: data.conversations,
        },
        { markAsNative: false }
      );
    } catch {
      applyVaultData(
        {
          path: "",
          folders: [],
          graph: null,
          conversations: [],
        },
        { markAsNative: false }
      );
    }
  }, [hasNativeVaultData, applyVaultData]);

  useEffect(() => {
    void loadPresetVaultData();
  }, [loadPresetVaultData]);

  useEffect(() => {
    const applyNativePayload = (payload?: NativeVaultPayload) => {
      if (!payload) return;
      applyVaultData(
        {
          path: payload.path,
          folders: payload.folders,
          graph: payload.graph,
          conversations: payload.conversations,
        },
        { markAsNative: true }
      );
    };

    const handleNativeVaultSelection = (event: Event) => {
      const customEvent = event as CustomEvent<NativeVaultPayload>;
      applyNativePayload(customEvent.detail);
    };

    window.addEventListener("brain2-native-vault-selected", handleNativeVaultSelection);

    const nativeState = (window as Window & { Brain2NativeState?: NativeVaultPayload }).Brain2NativeState;
    if (nativeState) {
      applyNativePayload(nativeState);
    }

    return () => {
      window.removeEventListener("brain2-native-vault-selected", handleNativeVaultSelection);
    };
  }, [applyVaultData]);

  useEffect(() => {
    if (selectedConversationId && !selectedConversation) {
      setSelectedConversationId(null);
    }
  }, [selectedConversationId, selectedConversation]);

  // When opening brain view, build graph from vault
  const handleOpenBrain = useCallback(async () => {
    setIsChatOpen(false);
    setIsSettingsOpen(false);
    setIsYourBrainOpen(true);
    if (!hasNativeVaultData) {
      await loadPresetVaultData();
    }
  }, [hasNativeVaultData, loadPresetVaultData]);

  const handleVaultChange = useCallback(() => {
    setHasNativeVaultData(false);
    void loadPresetVaultData({ force: true });
  }, [loadPresetVaultData]);

  const handleConversationSelect = useCallback((
    conversation: VaultConversation,
    options?: { fromYourBrain?: boolean }
  ) => {
    setIsChatOpen(false);
    setIsSettingsOpen(false);
    setIsYourBrainOpen(false);
    setSelectedConversationId(conversation.id);
    setReturnToYourBrainOnConversationClose(Boolean(options?.fromYourBrain));
  }, []);

  const handleOpenConversationFromNode = useCallback((nodeId: string, nodeLabel: string) => {
    const normalizedNodeId = nodeId.trim().toLowerCase();
    const normalizedNodeLabel = nodeLabel.trim().toLowerCase();

    const match = vaultConversations.find((conversation) => {
      const normalizedTitle = conversation.title.trim().toLowerCase();
      return normalizedTitle === normalizedNodeId || normalizedTitle === normalizedNodeLabel;
    });

    if (match) {
      handleConversationSelect(match, { fromYourBrain: true });
    }
  }, [vaultConversations, handleConversationSelect]);

  const handleCloseConversation = useCallback(() => {
    setSelectedConversationId(null);
    if (returnToYourBrainOnConversationClose) {
      setIsYourBrainOpen(true);
    }
    setReturnToYourBrainOnConversationClose(false);
  }, [returnToYourBrainOnConversationClose]);

  const persistChatConversation = useCallback((params: {
    sessionId: string;
    startedAt: number;
    model: string;
    messages: ChatMessage[];
  }) => {
    const title = buildChatTitle(params.messages);
    const markdown = buildChatMarkdown({
      title,
      startedAt: params.startedAt,
      model: params.model,
      messages: params.messages,
    });

    const safeConversationID = sanitizeFileName(params.sessionId);
    const safeTitle = sanitizeFileName(title);
    const memoryPath = `Brain2Memories/${safeConversationID}-${safeTitle}.md`;
    const optimisticConversation: VaultConversation = {
      id: memoryPath.toLowerCase(),
      title,
      path: memoryPath,
      modifiedAt: Date.now(),
      content: markdown,
    };

    setVaultConversations((previous) => {
      const next = previous.filter((conversation) => conversation.id !== optimisticConversation.id);
      return [optimisticConversation, ...next].sort((a, b) => b.modifiedAt - a.modifiedAt);
    });

    const bridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
    if (!bridge?.saveConversation) return;

    bridge.saveConversation({
      conversationId: params.sessionId,
      title,
      markdown,
    });
  }, []);

  const handleSendToBrain = useCallback(async (payload: { content: string; model: string; apiKey: string }) => {
    setIsChatOpen(true);
    const sessionId = chatSessionId ?? createMessageId();
    const startedAt = chatSessionStartedAt ?? Date.now();
    if (!chatSessionId) {
      setChatSessionId(sessionId);
      setChatSessionStartedAt(startedAt);
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: payload.content,
    };

    const requestMessages: ChatMessage[] = [...chatMessages, userMessage];
    setChatMessages(requestMessages);

    setChatError(null);
    setIsSettingsOpen(false);
    setIsYourBrainOpen(false);
    setSelectedFolderPath(null);
    setSelectedConversationId(null);
    setReturnToYourBrainOnConversationClose(false);
    setChatLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: payload.model,
          apiKey: payload.apiKey,
          messages: requestMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Falha ao consultar o modelo LLM.");
      }

      const assistantText = data.message?.trim();
      if (!assistantText) {
        throw new Error("Resposta vazia do modelo.");
      }

      const nextMessages = [
        ...requestMessages,
        {
          id: createMessageId(),
          role: "assistant" as const,
          content: assistantText,
        },
      ];
      setChatMessages(nextMessages);
      persistChatConversation({
        sessionId,
        startedAt,
        model: payload.model,
        messages: nextMessages,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao gerar resposta.";
      setChatError(message);

      // Persist at least the user-side message so no chat is lost.
      persistChatConversation({
        sessionId,
        startedAt,
        model: payload.model,
        messages: requestMessages,
      });
    } finally {
      setChatLoading(false);
    }
  }, [chatMessages, chatSessionId, chatSessionStartedAt, createMessageId, persistChatConversation]);

  const handleNewConversation = useCallback(() => {
    setIsSettingsOpen(false);
    setIsYourBrainOpen(false);
    setSelectedConversationId(null);
    setReturnToYourBrainOnConversationClose(false);
    setChatMessages([]);
    setChatError(null);
    setChatLoading(false);
    setChatSessionId(null);
    setChatSessionStartedAt(null);
    setIsChatOpen(true);
  }, []);

  return (
    <main
      style={{
        height: "100dvh",
        width: "100vw",
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        justifyContent: "flex-start",
        background: "var(--background)",
        overflow: "hidden",
        padding: 0,
        margin: 0,
        border: "none",
      }}
    >
      {!isSidebarHidden && (
        <DesktopSidebar
          onHide={() => setIsSidebarHidden(true)}
          onNewConversation={handleNewConversation}
          onYourBrain={handleOpenBrain}
          onSettings={() => { setIsChatOpen(false); setIsYourBrainOpen(false); setIsSettingsOpen(true); }}
          vaultFolders={vaultFolders}
          vaultConversations={vaultConversations}
          selectedFolderPath={selectedFolderPath}
          onFolderSelect={setSelectedFolderPath}
          selectedConversationId={selectedConversationId}
          onConversationSelect={handleConversationSelect}
        />
      )}

      {isMobileSidebarOpen && (
        <DesktopSidebar
          onHide={() => setIsMobileSidebarOpen(false)}
          onNewConversation={() => {
            setIsMobileSidebarOpen(false);
            handleNewConversation();
          }}
          onYourBrain={() => {
            setIsMobileSidebarOpen(false);
            handleOpenBrain();
          }}
          onSettings={() => {
            setIsMobileSidebarOpen(false);
            setIsChatOpen(false);
            setIsYourBrainOpen(false);
            setIsSettingsOpen(true);
          }}
          mobileFullscreen
          vaultFolders={vaultFolders}
          vaultConversations={vaultConversations}
          selectedFolderPath={selectedFolderPath}
          onFolderSelect={setSelectedFolderPath}
          selectedConversationId={selectedConversationId}
          onConversationSelect={(conversation) => {
            setIsMobileSidebarOpen(false);
            handleConversationSelect(conversation);
          }}
        />
      )}

      {!isMobileSidebarOpen && (
        <button
          className="mobile-sidebar-open-btn"
          aria-label="Exibir menu lateral"
          onClick={() => setIsMobileSidebarOpen(true)}
        >
          <PanelLeftOpen size={14} strokeWidth={2} />
          <span>Menu</span>
        </button>
      )}

      {isSidebarHidden && (
        <button
          className="sidebar-reopen-btn"
          aria-label="Mostrar barra lateral"
          onClick={() => setIsSidebarHidden(false)}
        >
          <PanelLeftOpen size={14} strokeWidth={2} />
          <span>Menu</span>
        </button>
      )}

      {/* Content area */}
      <section
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: activeView !== "home" ? "stretch" : "center",
          justifyContent: activeView !== "home" ? "stretch" : "center",
          gap: activeView !== "home" ? 0 : "10px",
          height: "100dvh",
          minHeight: 0,
          userSelect: activeView !== "home" ? "auto" : "none",
          pointerEvents: activeView !== "home" ? "all" : "none",
          padding: activeView !== "home" ? 0 : "0 20px",
          overflow: "hidden",
        }}
      >
        {activeView === "brain" ? (
          <BrainGraphView
            key={`brain-${vaultDataVersion}`}
            onClose={() => setIsYourBrainOpen(false)}
            graph={vaultGraph}
            loading={graphLoading}
            onOpenConversationFromNode={handleOpenConversationFromNode}
          />
        ) : activeView === "chat" ? (
          <ChatView
            title={chatTitle}
            messages={chatMessages}
            loading={chatLoading}
            error={chatError}
          />
        ) : activeView === "conversation" && selectedConversation ? (
          <ConversationView
            conversation={selectedConversation}
            onClose={handleCloseConversation}
          />
        ) : activeView === "settings" ? (
          <SettingsView
            onClose={() => setIsSettingsOpen(false)}
            onVaultChange={handleVaultChange}
            vaultHandle={null}
            nativeVaultPath={vaultPath}
          />
        ) : (
          <>
            <h1
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: "clamp(2rem, 5vw, 3.4rem)",
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#d4d4d4",
                margin: 0,
              }}
            >
              Brain2
            </h1>
            <p
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: "clamp(0.65rem, 1.4vw, 0.78rem)",
                fontWeight: 300,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "#464646",
                margin: 0,
              }}
            >
              The Extension of Your Mind
            </p>
          </>
        )}
      </section>

      {/* Bottom input bar */}
      {!isMobileSidebarOpen && (activeView === "home" || activeView === "conversation" || activeView === "chat") && (
        <InputBar
          desktopSidebarOffset={!isSidebarHidden}
          isSending={chatLoading}
          onSend={handleSendToBrain}
        />
      )}

      <style jsx>{`
        .mobile-sidebar-open-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          position: fixed;
          top: 14px;
          left: 14px;
          height: 30px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: var(--bar-bg);
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          padding: 0 10px;
          z-index: 1200;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .mobile-sidebar-open-btn:hover {
          background: var(--pill-bg);
          color: var(--muted-hover);
        }

        @media (min-width: 980px) {
          .mobile-sidebar-open-btn {
            display: none;
          }
        }

        .sidebar-reopen-btn {
          display: none;
        }

        @media (min-width: 980px) {
          .sidebar-reopen-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            position: fixed;
            top: 18px;
            left: 18px;
            height: 30px;
            border: 1px solid var(--bar-border);
            border-radius: 9px;
            background: var(--bar-bg);
            color: var(--muted);
            font-family: 'Inter', sans-serif;
            font-size: 12px;
            padding: 0 10px;
            z-index: 1200;
            transition: background 0.15s ease, color 0.15s ease;
          }

          .sidebar-reopen-btn:hover {
            background: var(--pill-bg);
            color: var(--muted-hover);
          }
        }
      `}</style>
    </main>
  );
}

