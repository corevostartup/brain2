"use client";

import { useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { FolderTreeNode } from "@/lib/vault";

const folders = [
  {
    name: "Projetos",
    children: ["Brain2", "Pesquisa"] as string[],
  },
  {
    name: "Pessoal",
    children: [] as string[],
  },
  {
    name: "Clientes",
    children: [] as string[],
  },
  {
    name: "Arquivo",
    children: [] as string[],
  },
];

const conversations = [
  "Roadmap do produto",
  "Resumo da reunião",
  "Ideias para onboarding",
  "Prompt de análise",
  "Checklist de lançamento",
];

/* ── Recursive folder row ── */
function FolderRow({ node, depth = 0 }: { node: FolderTreeNode; depth?: number }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <button
        className="list-item"
        type="button"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => hasChildren && setOpen((o) => !o)}
      >
        {hasChildren ? (
          <ChevronRight
            size={11}
            strokeWidth={2}
            style={{
              transition: "transform 0.15s ease",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}
          />
        ) : (
          <span style={{ width: 11, flexShrink: 0 }} />
        )}
        {open ? (
          <FolderOpen size={13} strokeWidth={1.8} />
        ) : (
          <Folder size={13} strokeWidth={1.8} />
        )}
        <span>{node.name}</span>
      </button>

      {open && hasChildren && (
        <ul className="item-list">
          {node.children.map((child) => (
            <FolderRow key={child.name} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

type DesktopSidebarProps = {
  onHide: () => void;
  onYourBrain?: () => void;
  onSettings?: () => void;
  mobileFullscreen?: boolean;
  vaultFolders?: FolderTreeNode[];
};

export default function DesktopSidebar({ onHide, onYourBrain, onSettings, mobileFullscreen = false, vaultFolders = [] }: DesktopSidebarProps) {
  return (
    <aside
      className={`desktop-sidebar${mobileFullscreen ? " desktop-sidebar--mobile" : ""}`}
      aria-label="Menu lateral"
    >
      <div className="sidebar-card">
        <div className="brand-row">
          <h2>Brain2</h2>
          <div className="brand-actions">
            <button className="icon-btn" aria-label="Novo chat">
              <Plus size={14} strokeWidth={2} />
            </button>
            <button className="icon-btn" aria-label="Ocultar barra lateral" onClick={onHide}>
              <PanelLeftClose size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="search-stack">
          <label className="search-field" aria-label="Buscar conversas">
            <Search size={13} strokeWidth={1.8} />
            <input type="text" placeholder="Buscar conversas" />
          </label>
        </div>

        <button className="your-brain-btn" type="button" aria-label="Your Brain" onClick={onYourBrain}>
          Your Brain
        </button>

        <section className="section-block folders-section" aria-label="Pastas">
          <p className="section-title">Pastas</p>
          <ul className="item-list folder-tree">
            {vaultFolders.length > 0
              ? vaultFolders.map((node) => (
                  <FolderRow key={node.name} node={node} />
                ))
              : folders.map((folder) => (
                  <li key={folder.name}>
                    <button className="list-item" type="button">
                      <Folder size={13} strokeWidth={1.8} />
                      <span>{folder.name}</span>
                    </button>
                    {folder.children.length > 0 && (
                      <ul className="sub-list">
                        {folder.children.map((child) => (
                          <li key={child}>
                            <button className="list-item sub-item" type="button">
                              <FolderOpen size={12} strokeWidth={1.8} />
                              <span>{child}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
          </ul>
        </section>

        <section className="section-block" aria-label="Todas as conversas">
          <p className="section-title">Todas as conversas</p>
          <ul className="item-list">
            {conversations.map((chat) => (
              <li key={chat}>
                <button className="list-item" type="button">
                  <MessageSquare size={13} strokeWidth={1.8} />
                  <span>{chat}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="promo-card" role="note" aria-label="Upgrade para plano pro">
          <div className="promo-title-row">
            <Sparkles size={13} strokeWidth={1.8} />
            <p>Upgrade plano pro</p>
          </div>
          <span>Mais contexto, velocidade e agentes avançados.</span>
          <button type="button">Fazer upgrade</button>
        </div>

        <div className="bottom-actions">
          <button className="user-row" type="button" aria-label="Usuário">
            <span className="user-avatar">U</span>
            <span>Usuário</span>
          </button>
          <button className="icon-btn settings-btn" type="button" aria-label="Configurações" onClick={onSettings}>
            <Settings size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <style jsx>{`
        .desktop-sidebar {
          display: none;
        }

        @media (min-width: 980px) {
          .desktop-sidebar {
            display: block;
            width: var(--desktop-sidebar-width);
            height: calc(100dvh - 24px);
            padding: 12px 0 12px 12px;
          }
        }

        @media (max-width: 979px) {
          .desktop-sidebar--mobile {
            display: block;
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100dvh;
            padding: 0;
            z-index: 1300;
            background: var(--background);
          }

          .desktop-sidebar--mobile .sidebar-card {
            border-radius: 0;
            border: none;
            height: 100dvh;
            padding: 14px 12px 16px;
          }
        }

        .sidebar-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          height: 100%;
          background: var(--bar-bg);
          border: 1px solid var(--bar-border);
          border-radius: 18px;
          padding: 12px;
        }

        .brand-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .brand-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .brand-row h2 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--foreground);
          font-weight: 500;
        }

        .icon-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: var(--muted);
          transition: background 0.15s ease, color 0.15s ease;
        }

        .icon-btn:hover {
          background: var(--pill-active);
          color: var(--muted-hover);
        }

        .search-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .search-field {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 32px;
          border-radius: 10px;
          border: 1px solid var(--bar-border);
          background: rgba(255, 255, 255, 0.02);
          padding: 0 9px;
          color: var(--muted);
          transition: border-color 0.15s ease;
        }

        .search-field:focus-within {
          border-color: var(--bar-border-hover);
        }

        .search-field input {
          width: 100%;
          border: none;
          background: transparent;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--foreground);
        }

        .search-field input::placeholder {
          color: var(--muted);
        }

        .your-brain-btn {
          height: 30px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.02);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.01em;
          text-align: left;
          padding: 0 10px;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .your-brain-btn:hover {
          background: var(--pill-bg);
          border-color: var(--bar-border-hover);
        }

        .section-block {
          display: flex;
          flex-direction: column;
          gap: 7px;
          min-height: 0;
        }

        .folders-section {
          flex: 1;
          overflow: hidden;
        }

        .folder-tree {
          overflow-y: auto;
          flex: 1;
        }

        .folder-tree::-webkit-scrollbar {
          width: 4px;
        }

        .folder-tree::-webkit-scrollbar-track {
          background: transparent;
        }

        .folder-tree::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 4px;
        }

        .section-title {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: #6b6b6b;
          font-weight: 500;
        }

        .item-list,
        .sub-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-height: 0;
        }

        .list-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 7px;
          border: none;
          height: 28px;
          border-radius: 8px;
          padding: 0 8px;
          background: transparent;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          text-align: left;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .list-item:hover {
          background: var(--pill-bg);
          color: var(--muted-hover);
        }

        .sub-list {
          margin-left: 12px;
        }

        .sub-item {
          color: #6d6d6d;
        }

        .promo-card {
          margin-top: auto;
          border: 1px solid var(--bar-border);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.02);
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .promo-title-row {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--foreground);
        }

        .promo-title-row p {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
        }

        .promo-card span {
          color: #767676;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          line-height: 1.35;
        }

        .promo-card button {
          height: 28px;
          border: 1px solid var(--bar-border);
          border-radius: 8px;
          background: transparent;
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          transition: background 0.15s ease;
        }

        .promo-card button:hover {
          background: var(--pill-bg);
        }

        .user-row {
          flex: 1;
          height: 34px;
          border: none;
          border-radius: 9px;
          background: transparent;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 6px;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .user-row:hover {
          background: var(--pill-bg);
          color: var(--muted-hover);
        }

        .user-avatar {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 1px solid var(--bar-border);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #8f8f8f;
          background: rgba(255, 255, 255, 0.02);
        }

        .bottom-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .settings-btn {
          flex-shrink: 0;
        }
      `}</style>
    </aside>
  );
}