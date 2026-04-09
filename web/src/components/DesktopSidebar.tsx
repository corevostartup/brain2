"use client";
// @refresh reset

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Folder,
  FolderPlus,
  FolderOpen,
  LoaderCircle,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { formatConversationDisplayTitle, type FolderTreeNode, type VaultConversation } from "@/lib/vault";

const HIDDEN_ROOT_FOLDERS = new Set(["Brain2Memories"]);

type FolderRow = {
  name: string;
  path: string;
  depth: number;
};

type FolderContextMenuState = {
  name: string;
  path: string;
  x: number;
  y: number;
  /** Área vazia da lista: só «Nova pasta» (parent = path). */
  onlyNovaPasta?: boolean;
};

type ConversationContextMenuState = {
  id: string;
  title: string;
  path: string;
  x: number;
  y: number;
};

type DraftFolderPlacement = {
  index: number;
  depth: number;
};

function collectFolderRows(
  nodes: FolderTreeNode[],
  parentPath = "",
  depth = 0
): FolderRow[] {
  const rows: FolderRow[] = [];

  for (const node of nodes) {
    if (node.kind !== "folder") {
      continue;
    }

    if (depth === 0 && HIDDEN_ROOT_FOLDERS.has(node.name)) {
      continue;
    }

    const rowPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    rows.push({ name: node.name, path: rowPath, depth });
    rows.push(...collectFolderRows(node.children, rowPath, depth + 1));
  }

  return rows;
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

function isValidAvatarPhotoURL(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isFolderCorrelationConversationPath(conversationPath: string): boolean {
  const normalizedPath = conversationPath.replace(/\\/g, "/").trim();
  if (!normalizedPath.toLowerCase().endsWith(".md")) {
    return false;
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length < 2) {
    return false;
  }

  const fileName = segments[segments.length - 1];
  const parentFolderName = segments[segments.length - 2];
  const fileBaseName = fileName.slice(0, -3);

  return fileBaseName.toLowerCase() === parentFolderName.toLowerCase();
}

type DesktopSidebarProps = {
  onHide: () => void;
  onNewConversation?: () => void;
  onYourBrain?: () => void;
  onSettings?: () => void;
  onLogout?: () => void | Promise<void>;
  userName?: string | null;
  userPhotoURL?: string | null;
  mobileFullscreen?: boolean;
  vaultLoading?: boolean;
  vaultFolders?: FolderTreeNode[];
  vaultConversations?: VaultConversation[];
  selectedFolderPath?: string | null;
  onFolderSelect?: (path: string | null) => void;
  selectedConversationId?: string | null;
  onConversationSelect?: (conversation: VaultConversation) => void;
  onCreateFolder?: (parentPath: string, folderName: string) => void | Promise<void>;
  onDeleteFolder?: (folderPath: string) => void | Promise<void>;
  onRenameFolder?: (folderPath: string, nextName: string) => void | Promise<void>;
  onRenameConversation?: (conversationPath: string, nextTitle: string) => void | Promise<void>;
  onDeleteConversation?: (conversationPath: string, conversationTitle: string) => void | Promise<void>;
};

export default function DesktopSidebar({
  onHide,
  onNewConversation,
  onYourBrain,
  onSettings,
  onLogout,
  userName = null,
  userPhotoURL = null,
  mobileFullscreen = false,
  vaultLoading = false,
  vaultFolders = [],
  vaultConversations = [],
  selectedFolderPath = null,
  onFolderSelect,
  selectedConversationId = null,
  onConversationSelect,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onRenameConversation,
  onDeleteConversation,
}: DesktopSidebarProps) {
  const normalizedUserName = userName?.trim() || "Usuário";
  const userInitial = normalizedUserName.charAt(0).toUpperCase();
  const normalizedUserPhotoURL = userPhotoURL?.trim() || "";
  const hasUserPhoto =
    normalizedUserPhotoURL.length > 0 && isValidAvatarPhotoURL(normalizedUserPhotoURL);
  const [userPhotoLoadFailed, setUserPhotoLoadFailed] = useState(false);

  useEffect(() => {
    setUserPhotoLoadFailed(false);
  }, [normalizedUserPhotoURL]);

  const showUserPhoto = hasUserPhoto && !userPhotoLoadFailed;
  const folderRows = useMemo(() => collectFolderRows(vaultFolders), [vaultFolders]);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
  const [conversationContextMenu, setConversationContextMenu] = useState<ConversationContextMenuState | null>(null);
  const [createFolderParentPath, setCreateFolderParentPath] = useState<string | null>(null);
  const [createFolderName, setCreateFolderName] = useState("");
  const [createFolderSubmitting, setCreateFolderSubmitting] = useState(false);
  const [renameFolderPath, setRenameFolderPath] = useState<string | null>(null);
  const [renameFolderOriginalName, setRenameFolderOriginalName] = useState("");
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renameFolderSubmitting, setRenameFolderSubmitting] = useState(false);
  const [renameConversationPath, setRenameConversationPath] = useState<string | null>(null);
  const [renameConversationOriginalTitle, setRenameConversationOriginalTitle] = useState("");
  const [renameConversationName, setRenameConversationName] = useState("");
  const [renameConversationSubmitting, setRenameConversationSubmitting] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const createFolderInputRef = useRef<HTMLInputElement | null>(null);
  const renameFolderInputRef = useRef<HTMLInputElement | null>(null);
  const renameConversationInputRef = useRef<HTMLInputElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const userButtonRef = useRef<HTMLButtonElement | null>(null);

  const openCreateFolderInput = useCallback((parentPath: string) => {
    setCreateFolderParentPath(parentPath);
    setCreateFolderName("");
    setCreateFolderSubmitting(false);
    setRenameFolderPath(null);
    setRenameFolderOriginalName("");
    setRenameFolderName("");
    setRenameFolderSubmitting(false);
    setRenameConversationPath(null);
    setRenameConversationOriginalTitle("");
    setRenameConversationName("");
    setRenameConversationSubmitting(false);
    setUserMenuOpen(false);
    setFolderContextMenu(null);
    setConversationContextMenu(null);
  }, []);

  const closeCreateFolderInput = useCallback(() => {
    setCreateFolderParentPath(null);
    setCreateFolderName("");
    setCreateFolderSubmitting(false);
  }, []);

  const openRenameConversationInput = useCallback((conversationPath: string, currentTitle: string) => {
    setRenameConversationPath(conversationPath);
    setRenameConversationOriginalTitle(currentTitle);
    setRenameConversationName(currentTitle);
    setRenameConversationSubmitting(false);
    setCreateFolderParentPath(null);
    setCreateFolderName("");
    setRenameFolderPath(null);
    setRenameFolderOriginalName("");
    setRenameFolderName("");
    setRenameFolderSubmitting(false);
    setUserMenuOpen(false);
    setFolderContextMenu(null);
    setConversationContextMenu(null);
  }, []);

  const closeRenameConversationInput = useCallback(() => {
    setRenameConversationPath(null);
    setRenameConversationOriginalTitle("");
    setRenameConversationName("");
    setRenameConversationSubmitting(false);
  }, []);

  const openRenameFolderInput = useCallback((folderPath: string, currentName: string) => {
    setRenameFolderPath(folderPath);
    setRenameFolderOriginalName(currentName);
    setRenameFolderName(currentName);
    setRenameFolderSubmitting(false);
    setCreateFolderParentPath(null);
    setCreateFolderName("");
    setRenameConversationPath(null);
    setRenameConversationOriginalTitle("");
    setRenameConversationName("");
    setRenameConversationSubmitting(false);
    setUserMenuOpen(false);
    setFolderContextMenu(null);
    setConversationContextMenu(null);
  }, []);

  const closeRenameFolderInput = useCallback(() => {
    setRenameFolderPath(null);
    setRenameFolderOriginalName("");
    setRenameFolderName("");
    setRenameFolderSubmitting(false);
  }, []);

  const submitCreateFolder = useCallback(async (rawName?: string) => {
    const nextName = typeof rawName === "string" ? rawName : createFolderName;
    const trimmedName = nextName.trim();
    if (!trimmedName || createFolderParentPath === null) {
      return;
    }

    if (createFolderSubmitting) {
      return;
    }

    setCreateFolderSubmitting(true);
    try {
      await onCreateFolder?.(createFolderParentPath, trimmedName);
      closeCreateFolderInput();
    } catch {
      // Keep the input open if the action throws.
    } finally {
      setCreateFolderSubmitting(false);
    }
  }, [closeCreateFolderInput, createFolderName, createFolderParentPath, createFolderSubmitting, onCreateFolder]);

  const handleCreateFolderKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitCreateFolder();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeCreateFolderInput();
    }
  }, [closeCreateFolderInput, submitCreateFolder]);

  const handleCreateFolderBlur = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    const currentValue = event.currentTarget.value;

    if (currentValue.trim()) {
      void submitCreateFolder(currentValue);
      return;
    }

    closeCreateFolderInput();
  }, [closeCreateFolderInput, submitCreateFolder]);

  const submitRenameFolder = useCallback(async () => {
    const trimmedName = renameFolderName.trim();
    if (!trimmedName || !renameFolderPath) {
      return;
    }

    if (trimmedName === renameFolderOriginalName) {
      closeRenameFolderInput();
      return;
    }

    if (renameFolderSubmitting) {
      return;
    }

    setRenameFolderSubmitting(true);
    try {
      await onRenameFolder?.(renameFolderPath, trimmedName);
      closeRenameFolderInput();
    } catch {
      // Keep the input open if renaming fails.
    } finally {
      setRenameFolderSubmitting(false);
    }
  }, [closeRenameFolderInput, onRenameFolder, renameFolderName, renameFolderOriginalName, renameFolderPath, renameFolderSubmitting]);

  const handleRenameFolderKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitRenameFolder();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeRenameFolderInput();
    }
  }, [closeRenameFolderInput, submitRenameFolder]);

  const submitRenameConversation = useCallback(async () => {
    const trimmedName = renameConversationName.trim();
    if (!trimmedName || !renameConversationPath) {
      return;
    }

    if (trimmedName === renameConversationOriginalTitle) {
      closeRenameConversationInput();
      return;
    }

    if (renameConversationSubmitting) {
      return;
    }

    setRenameConversationSubmitting(true);
    try {
      await onRenameConversation?.(renameConversationPath, trimmedName);
      closeRenameConversationInput();
    } catch {
      // Keep the input open if renaming fails.
    } finally {
      setRenameConversationSubmitting(false);
    }
  }, [
    closeRenameConversationInput,
    onRenameConversation,
    renameConversationName,
    renameConversationOriginalTitle,
    renameConversationPath,
    renameConversationSubmitting,
  ]);

  const handleRenameConversationKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitRenameConversation();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeRenameConversationInput();
    }
  }, [closeRenameConversationInput, submitRenameConversation]);

  const handleFolderContextMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>, folder: FolderRow) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 170;
    const menuHeight = 116;
    const x = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8));
    const y = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8));

    setFolderContextMenu({
      name: folder.name,
      path: folder.path,
      x,
      y,
    });
    setConversationContextMenu(null);
    setUserMenuOpen(false);
  }, []);

  const handleFolderTreeEmptyAreaContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLUListElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (
        target.closest("button") ||
        target.closest("input") ||
        target.closest(".list-item--draft") ||
        target.closest(".vault-loading-row")
      ) {
        return;
      }

      event.preventDefault();
      const menuWidth = 170;
      const menuHeight = 48;
      const x = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8));
      const y = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8));

      const parentPath = selectedFolderPath ?? "";

      setFolderContextMenu({
        name: "",
        path: parentPath,
        x,
        y,
        onlyNovaPasta: true,
      });
      setConversationContextMenu(null);
      setUserMenuOpen(false);
    },
    [selectedFolderPath]
  );

  const handleConversationContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, conversation: VaultConversation) => {
      event.preventDefault();
      event.stopPropagation();
      const menuWidth = 180;
      const menuHeight = 84;
      const x = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8));
      const y = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8));

      setConversationContextMenu({
        id: conversation.id,
        title: conversation.title,
        path: conversation.path,
        x,
        y,
      });
      setFolderContextMenu(null);
      setUserMenuOpen(false);
    },
    []
  );

  useEffect(() => {
    if (!folderContextMenu && !conversationContextMenu) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFolderContextMenu(null);
        setConversationContextMenu(null);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [folderContextMenu, conversationContextMenu]);

  useEffect(() => {
    setFolderContextMenu(null);
    setConversationContextMenu(null);
    setUserMenuOpen(false);
    closeCreateFolderInput();
    closeRenameFolderInput();
    closeRenameConversationInput();
  }, [closeCreateFolderInput, closeRenameConversationInput, closeRenameFolderInput, mobileFullscreen]);

  useEffect(() => {
    if (!userMenuOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
      }
    };

    const closeOnPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current?.contains(target) || userButtonRef.current?.contains(target)) {
        return;
      }

      setUserMenuOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("mousedown", closeOnPointerDown);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("mousedown", closeOnPointerDown);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (createFolderParentPath === null) {
      return;
    }

    createFolderInputRef.current?.focus();
  }, [createFolderParentPath]);

  useEffect(() => {
    if (!renameFolderPath) {
      return;
    }

    renameFolderInputRef.current?.focus();
    renameFolderInputRef.current?.select();
  }, [renameFolderPath]);

  useEffect(() => {
    if (!renameConversationPath) {
      return;
    }

    renameConversationInputRef.current?.focus();
    renameConversationInputRef.current?.select();
  }, [renameConversationPath]);

  useEffect(() => {
    if (folderRows.length === 0) {
      setCreateFolderParentPath((previous) => (previous === null ? previous : ""));
      return;
    }

    if (!createFolderParentPath) {
      return;
    }

    const parentExists = folderRows.some((folder) => folder.path === createFolderParentPath);
    if (!parentExists) {
      setCreateFolderParentPath("");
    }
  }, [createFolderParentPath, folderRows]);

  const draftFolderPlacement = useMemo<DraftFolderPlacement | null>(() => {
    if (createFolderParentPath === null) {
      return null;
    }

    if (createFolderParentPath === "") {
      return {
        index: 0,
        depth: 0,
      };
    }

    const parentIndex = folderRows.findIndex((folder) => folder.path === createFolderParentPath);
    if (parentIndex === -1) {
      return {
        index: 0,
        depth: 0,
      };
    }

    let insertionIndex = parentIndex + 1;
    while (
      insertionIndex < folderRows.length &&
      folderRows[insertionIndex].path.startsWith(`${createFolderParentPath}/`)
    ) {
      insertionIndex += 1;
    }

    return {
      index: insertionIndex,
      depth: folderRows[parentIndex].depth + 1,
    };
  }, [createFolderParentPath, folderRows]);

  const filteredConversations = useMemo(() => {
    const scoped = selectedFolderPath
      ? vaultConversations.filter(
          (conversation) =>
            conversation.path === selectedFolderPath ||
            conversation.path.startsWith(`${selectedFolderPath}/`)
        )
      : vaultConversations;

    const visibleConversations = scoped.filter(
      (conversation) => !isFolderCorrelationConversationPath(conversation.path)
    );

    return [...visibleConversations].sort((a, b) => b.modifiedAt - a.modifiedAt);
  }, [selectedFolderPath, vaultConversations]);

  const renameConversationExistsInFilter = useMemo(() => {
    if (!renameConversationPath) {
      return true;
    }

    return filteredConversations.some((conversation) => conversation.path === renameConversationPath);
  }, [filteredConversations, renameConversationPath]);

  const renameFolderExistsInTree = useMemo(() => {
    if (!renameFolderPath) {
      return true;
    }

    return folderRows.some((folder) => folder.path === renameFolderPath);
  }, [folderRows, renameFolderPath]);

  useEffect(() => {
    if (!renameFolderPath) {
      return;
    }

    if (!renameFolderExistsInTree) {
      closeRenameFolderInput();
    }
  }, [closeRenameFolderInput, renameFolderExistsInTree, renameFolderPath]);

  useEffect(() => {
    if (!renameConversationPath) {
      return;
    }

    if (!renameConversationExistsInFilter) {
      closeRenameConversationInput();
    }
  }, [closeRenameConversationInput, renameConversationExistsInFilter, renameConversationPath]);

  return (
    <aside
      className={`desktop-sidebar${mobileFullscreen ? " desktop-sidebar--mobile" : ""}`}
      aria-label="Menu lateral"
    >
      <div className="sidebar-card">
        <div className="brand-row">
          <h2>Brain2</h2>
          <div className="brand-actions">
            <button className="icon-btn" aria-label="Ocultar barra lateral" onClick={onHide}>
              <PanelLeftClose size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="search-stack">
          <div className="search-row">
            <label className="search-field" aria-label="Buscar conversas">
              <Search size={13} strokeWidth={1.8} />
              <input type="text" placeholder="Buscar conversas" />
            </label>
            <button className="icon-btn" aria-label="Novo chat" onClick={onNewConversation}>
              <Plus size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        <button className="your-brain-btn" type="button" aria-label="Your Brain" onClick={onYourBrain}>
          Your Brain
        </button>

        <section className="section-block folders-section" aria-label="Pastas">
          <div className="section-header-row">
            <p className="section-title">Pastas</p>
            <button
              className="section-action-btn"
              type="button"
              aria-label="Nova pasta"
              disabled={vaultLoading}
              onClick={() => {
                openCreateFolderInput(selectedFolderPath ?? "");
              }}
            >
              <FolderPlus size={12} strokeWidth={1.8} />
              <span>Nova pasta</span>
            </button>
          </div>
          <ul
            className="item-list folder-tree"
            onContextMenu={handleFolderTreeEmptyAreaContextMenu}
          >
            {vaultLoading && folderRows.length === 0 && !draftFolderPlacement
              ? (
                <li className="vault-loading-row" aria-live="polite" aria-busy="true">
                  <span className="vault-loading-indicator">
                    <LoaderCircle className="vault-loading-spinner" size={13} strokeWidth={1.8} />
                    <span>Carregando pastas...</span>
                  </span>
                </li>
                )
              : folderRows.length > 0
              ? (
                <>
                  <li>
                    <button
                      className={`list-item${selectedFolderPath === null ? " list-item--active" : ""}`}
                      type="button"
                      onClick={() => onFolderSelect?.(null)}
                      aria-pressed={selectedFolderPath === null}
                    >
                      <FolderOpen size={12} strokeWidth={1.8} />
                      <span>Todas as pastas</span>
                    </button>
                  </li>
                    {folderRows.map((folder, index) => (
                      <Fragment key={folder.path}>
                        {draftFolderPlacement && draftFolderPlacement.index === index && (
                          <li className="draft-folder-row">
                            <div
                              className="list-item list-item--draft"
                              style={{ paddingLeft: `${8 + draftFolderPlacement.depth * 12}px` }}
                            >
                              <FolderPlus size={13} strokeWidth={1.8} />
                              <input
                                ref={createFolderInputRef}
                                className="draft-folder-input"
                                type="text"
                                value={createFolderName}
                                onChange={(event) => setCreateFolderName(event.target.value)}
                                onKeyDown={handleCreateFolderKeyDown}
                                onBlur={handleCreateFolderBlur}
                                placeholder="Nova pasta"
                                spellCheck={false}
                                aria-label="Nome da nova pasta"
                                disabled={createFolderSubmitting}
                              />
                            </div>
                          </li>
                        )}
                        <li>
                          {renameFolderPath === folder.path ? (
                            <div
                              className="list-item list-item--editing"
                              style={{ paddingLeft: `${8 + folder.depth * 12}px` }}
                            >
                              <Pencil size={12} strokeWidth={1.8} />
                              <input
                                ref={renameFolderInputRef}
                                className="rename-folder-input"
                                type="text"
                                value={renameFolderName}
                                onChange={(event) => setRenameFolderName(event.target.value)}
                                onKeyDown={handleRenameFolderKeyDown}
                                onBlur={() => {
                                  if (renameFolderSubmitting) {
                                    return;
                                  }
                                  const trimmed = renameFolderName.trim();
                                  if (!trimmed || trimmed === renameFolderOriginalName) {
                                    closeRenameFolderInput();
                                    return;
                                  }
                                  void submitRenameFolder();
                                }}
                                spellCheck={false}
                                aria-label="Renomear pasta"
                                disabled={renameFolderSubmitting}
                              />
                            </div>
                          ) : (
                            <button
                              className={`list-item${selectedFolderPath === folder.path ? " list-item--active" : ""}`}
                              type="button"
                              style={{ paddingLeft: `${8 + folder.depth * 12}px` }}
                              onClick={() => onFolderSelect?.(folder.path)}
                              onContextMenu={(event) => handleFolderContextMenu(event, folder)}
                              aria-pressed={selectedFolderPath === folder.path}
                            >
                              {folder.depth === 0 ? (
                                <Folder size={13} strokeWidth={1.8} />
                              ) : (
                                <FolderOpen size={12} strokeWidth={1.8} />
                              )}
                              <span>{folder.name}</span>
                            </button>
                          )}
                        </li>
                      </Fragment>
                    ))}
                    {draftFolderPlacement && draftFolderPlacement.index === folderRows.length && (
                      <li className="draft-folder-row">
                        <div
                          className="list-item list-item--draft"
                          style={{ paddingLeft: `${8 + draftFolderPlacement.depth * 12}px` }}
                        >
                          <FolderPlus size={13} strokeWidth={1.8} />
                          <input
                            ref={createFolderInputRef}
                            className="draft-folder-input"
                            type="text"
                            value={createFolderName}
                            onChange={(event) => setCreateFolderName(event.target.value)}
                            onKeyDown={handleCreateFolderKeyDown}
                            onBlur={handleCreateFolderBlur}
                            placeholder="Nova pasta"
                            spellCheck={false}
                            aria-label="Nome da nova pasta"
                            disabled={createFolderSubmitting}
                          />
                        </div>
                      </li>
                    )}
                </>
              )
              : (
                <>
                  {draftFolderPlacement
                    ? (
                      <li className="draft-folder-row">
                        <div className="list-item list-item--draft" style={{ paddingLeft: "8px" }}>
                          <FolderPlus size={13} strokeWidth={1.8} />
                          <input
                            ref={createFolderInputRef}
                            className="draft-folder-input"
                            type="text"
                            value={createFolderName}
                            onChange={(event) => setCreateFolderName(event.target.value)}
                            onKeyDown={handleCreateFolderKeyDown}
                            onBlur={handleCreateFolderBlur}
                            placeholder="Nova pasta"
                            spellCheck={false}
                            aria-label="Nome da nova pasta"
                            disabled={createFolderSubmitting}
                          />
                        </div>
                      </li>
                      )
                    : (
                      <li>
                        <span className="vault-empty-hint">Nenhuma pasta encontrada</span>
                      </li>
                      )}
                </>
              )}
          </ul>
        </section>

        <section className="section-block conversations-section" aria-label="Todas as conversas">
          <p className="section-title">Todas as conversas</p>
          <p className="section-subtitle">
            {vaultLoading
              ? "Carregando conversas..."
              : selectedFolderPath
              ? `${filteredConversations.length} arquivos .md em ${selectedFolderPath}`
              : `${filteredConversations.length} arquivos .md no vault`}
          </p>
          <ul className="item-list conversation-list">
            {vaultLoading && filteredConversations.length === 0
              ? (
                <li className="vault-loading-row" aria-live="polite" aria-busy="true">
                  <span className="vault-loading-indicator">
                    <LoaderCircle className="vault-loading-spinner" size={13} strokeWidth={1.8} />
                    <span>Carregando conversas...</span>
                  </span>
                </li>
                )
              : filteredConversations.length > 0
              ? filteredConversations.map((conversation) => (
              <li key={conversation.id}>
                {renameConversationPath === conversation.path ? (
                  <div
                    className="list-item conversation-item conversation-item--editing"
                    title={conversation.path}
                  >
                    <MessageSquare size={13} strokeWidth={1.8} />
                    <input
                      ref={renameConversationInputRef}
                      className="rename-conversation-input"
                      type="text"
                      value={renameConversationName}
                      onChange={(event) => setRenameConversationName(event.target.value)}
                      onKeyDown={handleRenameConversationKeyDown}
                      onBlur={() => {
                        if (renameConversationSubmitting) {
                          return;
                        }
                        const trimmed = renameConversationName.trim();
                        if (!trimmed || trimmed === renameConversationOriginalTitle) {
                          closeRenameConversationInput();
                          return;
                        }
                        void submitRenameConversation();
                      }}
                      spellCheck={false}
                      aria-label="Renomear conversa"
                      disabled={renameConversationSubmitting}
                    />
                  </div>
                ) : (
                  <button
                    className={`list-item conversation-item${selectedConversationId === conversation.id ? " conversation-item--active" : ""}`}
                    type="button"
                    title={conversation.path}
                    onClick={() => onConversationSelect?.(conversation)}
                    onContextMenu={(event) => handleConversationContextMenu(event, conversation)}
                    aria-pressed={selectedConversationId === conversation.id}
                  >
                    <MessageSquare size={13} strokeWidth={1.8} />
                    <span>{formatConversationDisplayTitle(conversation.title) || conversation.title}</span>
                    <small className="conversation-meta">{formatModifiedDate(conversation.modifiedAt)}</small>
                  </button>
                )}
              </li>
            ))
              : (
                <li>
                  <span className="vault-empty-hint">Nenhum arquivo .md encontrado para esta pasta.</span>
                </li>
              )}
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
          <div className="user-menu-wrap">
            <button
              ref={userButtonRef}
              className="user-row"
              type="button"
              aria-label="Usuário"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => {
                setFolderContextMenu(null);
                setConversationContextMenu(null);
                setUserMenuOpen((current) => !current);
              }}
            >
              <span className="user-avatar" aria-hidden="true">
                {showUserPhoto ? (
                  <img
                    src={normalizedUserPhotoURL}
                    alt=""
                    className="user-avatar-image"
                    referrerPolicy="no-referrer"
                    onError={() => setUserPhotoLoadFailed(true)}
                  />
                ) : (
                  userInitial
                )}
              </span>
              <span className="user-name" title={normalizedUserName}>{normalizedUserName}</span>
            </button>

            {userMenuOpen && (
              <div ref={userMenuRef} className="user-menu" role="menu" aria-label="Menu do usuário">
                <button
                  className="user-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    void onLogout?.();
                  }}
                >
                  <LogOut size={13} strokeWidth={1.8} />
                  <span>Fazer logout</span>
                </button>
              </div>
            )}
          </div>
          <button className="icon-btn settings-btn" type="button" aria-label="Configurações" onClick={onSettings}>
            <Settings size={14} strokeWidth={1.8} />
          </button>
        </div>

        {(folderContextMenu || conversationContextMenu) && (
          <>
            <button
              className="folder-context-backdrop"
              type="button"
              aria-label="Fechar menu de contexto"
              onClick={() => {
                setFolderContextMenu(null);
                setConversationContextMenu(null);
              }}
            />
          </>
        )}

        {folderContextMenu && (
          <>
            <div
              className="folder-context-menu"
              role="menu"
              aria-label={
                folderContextMenu.onlyNovaPasta
                  ? "Nova pasta na lista de pastas"
                  : `Ações da pasta ${folderContextMenu.name}`
              }
              style={{ left: `${folderContextMenu.x}px`, top: `${folderContextMenu.y}px` }}
            >
              <button
                className="folder-context-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  const parentPath = folderContextMenu.path;
                  setFolderContextMenu(null);
                  openCreateFolderInput(parentPath);
                }}
              >
                <FolderPlus size={13} strokeWidth={1.8} />
                <span>Nova pasta</span>
              </button>
              {!folderContextMenu.onlyNovaPasta && (
                <>
                  <button
                    className="folder-context-item"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const targetPath = folderContextMenu.path;
                      const currentName = folderContextMenu.name;
                      setFolderContextMenu(null);
                      openRenameFolderInput(targetPath, currentName);
                    }}
                  >
                    <Pencil size={13} strokeWidth={1.8} />
                    <span>Renomear</span>
                  </button>
                  <button
                    className="folder-context-item folder-context-item--danger"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const targetPath = folderContextMenu.path;
                      setFolderContextMenu(null);
                      void onDeleteFolder?.(targetPath);
                    }}
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                    <span>Excluir</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {conversationContextMenu && (
          <div
            className="folder-context-menu"
            role="menu"
            aria-label={`Ações da conversa ${formatConversationDisplayTitle(conversationContextMenu.title) || conversationContextMenu.title}`}
            style={{ left: `${conversationContextMenu.x}px`, top: `${conversationContextMenu.y}px` }}
          >
            <button
              className="folder-context-item"
              type="button"
              role="menuitem"
              onClick={() => {
                const targetPath = conversationContextMenu.path;
                const currentTitle = conversationContextMenu.title;
                setConversationContextMenu(null);
                openRenameConversationInput(targetPath, currentTitle);
              }}
            >
              <Pencil size={13} strokeWidth={1.8} />
              <span>Renomear</span>
            </button>
            <button
              className="folder-context-item folder-context-item--danger"
              type="button"
              role="menuitem"
              onClick={() => {
                const targetPath = conversationContextMenu.path;
                const currentTitle = conversationContextMenu.title;
                setConversationContextMenu(null);
                void onDeleteConversation?.(targetPath, currentTitle);
              }}
            >
              <Trash2 size={13} strokeWidth={1.8} />
              <span>Excluir</span>
            </button>
          </div>
        )}
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

        /* WKWebView (app Mac): altura em % em vez de dvh */
        :global(html[data-brain2-native]) .desktop-sidebar {
          display: block !important;
          width: var(--desktop-sidebar-width);
          height: 100% !important;
          max-height: 100% !important;
          min-height: 0 !important;
          padding: 12px 0 12px 12px;
          box-sizing: border-box;
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
          min-height: 0;
          background: var(--bar-bg);
          border: 1px solid var(--bar-border);
          border-radius: 18px;
          padding: 12px;
        }

        .brand-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
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
          flex-shrink: 0;
        }

        .search-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .search-field {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
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
          flex-shrink: 0;
          width: 100%;
          box-sizing: border-box;
          height: 30px;
          min-height: 30px;
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

        .vault-empty-hint {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #555;
          padding: 4px 8px;
        }

        .vault-loading-row {
          padding: 0;
        }

        .vault-loading-indicator {
          min-height: 28px;
          padding: 4px 8px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #7f7f7f;
        }

        :global(.vault-loading-spinner) {
          display: inline-block;
          animation: sidebar-spin 0.9s linear infinite;
          transform-origin: center;
          will-change: transform;
        }

        @keyframes sidebar-spin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
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

        .section-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .section-action-btn {
          height: 24px;
          border: 1px solid var(--bar-border);
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.02);
          color: var(--muted);
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 0 7px;
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          line-height: 1;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .section-action-btn:hover {
          background: var(--pill-bg);
          color: var(--muted-hover);
          border-color: var(--bar-border-hover);
        }

        .section-action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .section-subtitle {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          color: #595959;
        }

        .list-item--draft {
          background: rgba(255, 255, 255, 0.04);
          border: 1px dashed var(--bar-border-hover);
          color: var(--foreground);
        }

        .draft-folder-row {
          padding: 0;
        }

        .draft-folder-input {
          flex: 1;
          min-width: 0;
          height: 100%;
          border: none;
          background: transparent;
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          line-height: 1;
        }

        .draft-folder-input::placeholder {
          color: #7b7b7b;
        }

        .draft-folder-input:focus {
          outline: none;
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

        .list-item--active {
          background: var(--pill-bg);
          color: var(--muted-hover);
        }

        .sub-list {
          margin-left: 12px;
        }

        .sub-item {
          color: #6d6d6d;
        }

        .conversations-section {
          min-height: 160px;
          overflow: hidden;
        }

        .conversation-list {
          overflow-y: auto;
          max-height: 180px;
        }

        .conversation-item {
          justify-content: space-between;
        }

        .conversation-item--editing {
          background: rgba(255, 255, 255, 0.05);
          border: 1px dashed var(--bar-border-hover);
          color: var(--foreground);
        }

        .rename-conversation-input {
          flex: 1;
          min-width: 0;
          height: 100%;
          border: none;
          background: transparent;
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          line-height: 1;
        }

        .rename-conversation-input:focus {
          outline: none;
        }

        .list-item--editing {
          background: rgba(255, 255, 255, 0.05);
          border: 1px dashed var(--bar-border-hover);
          color: var(--foreground);
        }

        .rename-folder-input {
          flex: 1;
          min-width: 0;
          height: 100%;
          border: none;
          background: transparent;
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          line-height: 1;
        }

        .rename-folder-input:focus {
          outline: none;
        }

        .conversation-item--active {
          background: rgba(255, 255, 255, 0.1);
          color: #f1f1f1;
        }

        .conversation-item--active .conversation-meta {
          color: #8b8b8b;
        }

        :global(html[data-theme="light"]) .conversation-item--active,
        :global(body[data-theme="light"]) .conversation-item--active {
          background: rgba(25, 32, 43, 0.14);
          color: #15202b;
          box-shadow: inset 0 0 0 1px rgba(25, 32, 43, 0.2);
        }

        :global(html[data-theme="light"]) .conversation-item--active .conversation-meta,
        :global(body[data-theme="light"]) .conversation-item--active .conversation-meta {
          color: #3d4d61;
        }

        .conversation-item span {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .conversation-meta {
          color: #666;
          font-size: 10px;
          margin-left: 8px;
          white-space: nowrap;
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
          justify-content: flex-start;
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
          overflow: hidden;
          flex-shrink: 0;
        }

        .user-avatar-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .user-name {
          flex: 1;
          display: block;
          min-width: 0;
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .bottom-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .user-menu-wrap {
          position: relative;
          flex: 1;
          min-width: 0;
        }

        .user-menu {
          position: absolute;
          left: 0;
          right: 0;
          bottom: calc(100% + 6px);
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 6px;
          border-radius: 10px;
          border: 1px solid var(--bar-border-hover);
          background: #151515;
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
          z-index: 20;
        }

        .user-menu-item {
          width: 100%;
          height: 30px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: var(--foreground);
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 0 8px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          text-align: left;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .user-menu-item:hover {
          background: var(--pill-bg);
          color: #f5f5f5;
        }

        .folder-context-backdrop {
          position: fixed;
          inset: 0;
          border: none;
          padding: 0;
          margin: 0;
          background: transparent;
          z-index: 1380;
          cursor: default;
        }

        .folder-context-menu {
          position: fixed;
          width: 170px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 6px;
          border-radius: 10px;
          border: 1px solid var(--bar-border-hover);
          background: #151515;
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
          z-index: 1390;
        }

        .folder-context-item {
          width: 100%;
          height: 30px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: var(--foreground);
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 0 8px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          text-align: left;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .folder-context-item:hover {
          background: var(--pill-bg);
          color: #f5f5f5;
        }

        .folder-context-item--danger {
          color: #f28a8a;
        }

        .folder-context-item--danger:hover {
          background: rgba(242, 138, 138, 0.12);
          color: #ffadad;
        }

        .settings-btn {
          flex-shrink: 0;
        }
      `}</style>
    </aside>
  );
}