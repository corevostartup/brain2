"use client";

import { useState, useEffect, useCallback } from "react";
import InputBar from "@/components/InputBar";
import DesktopSidebar from "@/components/DesktopSidebar";
import BrainGraphView from "@/components/BrainGraphView";
import SettingsView from "@/components/SettingsView";
import { PanelLeftOpen } from "lucide-react";
import {
  loadDirectoryHandle,
  verifyPermission,
  buildGraphFromVault,
  readFolderTree,
  type VaultGraph,
  type FolderTreeNode,
} from "@/lib/vault";

export default function Home() {
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isYourBrainOpen, setIsYourBrainOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [vaultHandle, setVaultHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [vaultGraph, setVaultGraph] = useState<VaultGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [vaultFolders, setVaultFolders] = useState<FolderTreeNode[]>([]);

  const activeView = isSettingsOpen ? "settings" : isYourBrainOpen ? "brain" : "home";

  // Restore vault handle from IndexedDB on mount
  useEffect(() => {
    (async () => {
      const stored = await loadDirectoryHandle();
      if (stored) {
        const ok = await verifyPermission(stored);
        if (ok) {
          setVaultHandle(stored);
          readFolderTree(stored).then(setVaultFolders).catch(() => {});
        }
      }
    })();
  }, []);

  const loadVaultGraph = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setGraphLoading(true);
    try {
      const graph = await buildGraphFromVault(handle);
      setVaultGraph(graph);
    } catch {
      setVaultGraph(null);
    }
    setGraphLoading(false);
  }, []);

  // When opening brain view, build graph from vault
  const handleOpenBrain = useCallback(async () => {
    setIsSettingsOpen(false);
    setIsYourBrainOpen(true);
    if (vaultHandle) {
      await loadVaultGraph(vaultHandle);
    }
  }, [vaultHandle, loadVaultGraph]);

  const handleVaultChange = useCallback((handle: FileSystemDirectoryHandle | null) => {
    setVaultHandle(handle);
    if (!handle) {
      setVaultGraph(null);
      setVaultFolders([]);
    } else {
      readFolderTree(handle).then(setVaultFolders).catch(() => {});
    }
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
          onYourBrain={handleOpenBrain}
          onSettings={() => { setIsYourBrainOpen(false); setIsSettingsOpen(true); }}
          vaultFolders={vaultFolders}
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
            onClose={() => setIsYourBrainOpen(false)}
            graph={vaultGraph}
            loading={graphLoading}
          />
        ) : activeView === "settings" ? (
          <SettingsView
            onClose={() => setIsSettingsOpen(false)}
            onVaultChange={handleVaultChange}
            vaultHandle={vaultHandle}
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
      {!isMobileSidebarOpen && activeView === "home" && (
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

