"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import InputBar from "@/components/InputBar";
import DesktopSidebar from "@/components/DesktopSidebar";
import BrainGraphView from "@/components/BrainGraphView";
import ConversationView from "@/components/ConversationView";
import SettingsView from "@/components/SettingsView";
import { PanelLeftOpen } from "lucide-react";
import {
  type VaultConversation,
  type VaultGraph,
  type FolderTreeNode,
} from "@/lib/vault";

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

  const selectedConversation = useMemo(
    () => vaultConversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [selectedConversationId, vaultConversations]
  );

  const activeView = isSettingsOpen
    ? "settings"
    : isYourBrainOpen
      ? "brain"
      : selectedConversation
        ? "conversation"
        : "home";

  const applyVaultData = useCallback((
    data: {
      path?: string;
      folders?: FolderTreeNode[];
      graph?: VaultGraph | null;
      conversations?: VaultConversation[];
    },
    options?: { markAsNative?: boolean }
  ) => {
    setHasNativeVaultData(Boolean(options?.markAsNative));
    setVaultPath(data.path ?? "");
    setVaultFolders(data.folders ?? []);
    setVaultGraph(data.graph ?? null);
    setVaultConversations(data.conversations ?? []);
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
          onYourBrain={handleOpenBrain}
          onSettings={() => { setIsYourBrainOpen(false); setIsSettingsOpen(true); }}
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
          onYourBrain={() => {
            setIsMobileSidebarOpen(false);
            handleOpenBrain();
          }}
          onSettings={() => {
            setIsMobileSidebarOpen(false);
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
      {!isMobileSidebarOpen && (activeView === "home" || activeView === "conversation") && (
        <InputBar desktopSidebarOffset={!isSidebarHidden} />
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

