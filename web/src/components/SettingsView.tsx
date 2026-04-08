"use client";

import { useState, useEffect, useRef } from "react";
import { X, FolderOpen, Check, Trash2, Cloud } from "lucide-react";
import {
  pickDirectory,
  saveDirectoryHandle,
  clearDirectoryHandle,
  saveVaultPath,
  loadVaultPath,
} from "@/lib/vault";
import {
  listGoogleDriveFolders,
  type GoogleDriveFolder,
} from "@/lib/googleDrive";
import {
  CLOUD_PROVIDER_STORAGE_KEY,
  getCloudDirectoryLabelStorageKey,
  getCloudDirectoryStorageKey,
  getVaultStorageMode,
  type CloudProvider,
  type VaultStorageMode,
} from "@/lib/vaultCloudConfig";

type SettingsViewProps = {
  onClose: () => void;
  onVaultChange: (handle: FileSystemDirectoryHandle | null) => void;
  vaultHandle: FileSystemDirectoryHandle | null;
  nativeVaultPath?: string;
  /** Chamado apos alterar origem do vault (Drive, iCloud, local) ou guardar pasta na nuvem. */
  onCloudVaultSaved?: () => void;
};

type NativeBridge = {
  isAvailable?: boolean;
  pickDirectory?: () => void;
  renameVault?: (payload: { name: string }) => void;
};

type NativeRenameResult = {
  success?: boolean;
  error?: string;
};

type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "brain2-theme";

function normalizeTheme(value: string | null | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  const htmlTheme = document.documentElement.getAttribute("data-theme");
  const bodyTheme = document.body.getAttribute("data-theme");
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return normalizeTheme(htmlTheme || bodyTheme || savedTheme);
}

function applyThemeToDocument(theme: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", theme);
  if (document.body) {
    document.body.setAttribute("data-theme", theme);
  }
}

function resolveInitialVaultStorageMode(): VaultStorageMode {
  if (typeof window === "undefined") {
    return "local";
  }
  return getVaultStorageMode();
}

function parseGoogleDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const folderPathMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderPathMatch?.[1]) {
      return folderPathMatch[1];
    }

    const idFromQuery = url.searchParams.get("id");
    if (idFromQuery && /^[a-zA-Z0-9_-]{10,}$/.test(idFromQuery)) {
      return idFromQuery;
    }
  } catch {
    return null;
  }

  return null;
}

function extractVaultNameFromPath(pathValue: string): string {
  const normalized = pathValue.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }

  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? "";
}

export default function SettingsView({
  onClose,
  onVaultChange,
  vaultHandle,
  nativeVaultPath,
  onCloudVaultSaved,
}: SettingsViewProps) {
  const [vaultPath, setVaultPath] = useState<string>(() => (
    typeof window === "undefined" ? "" : (loadVaultPath() ?? "")
  ));
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pasteSaved, setPasteSaved] = useState(false);
  const [nativePickerAvailable, setNativePickerAvailable] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme());
  const [vaultStorageMode, setVaultStorageMode] = useState<VaultStorageMode>(() => resolveInitialVaultStorageMode());
  const [cloudDirectory, setCloudDirectory] = useState("");
  const [cloudDirectoryLabel, setCloudDirectoryLabel] = useState("");
  const [cloudStatus, setCloudStatus] = useState<"idle" | "saved" | "error">("idle");
  const [cloudError, setCloudError] = useState("");
  const [googleDrivePickerOpen, setGoogleDrivePickerOpen] = useState(false);
  const [googleDriveLoading, setGoogleDriveLoading] = useState(false);
  const [googleDriveFolders, setGoogleDriveFolders] = useState<GoogleDriveFolder[]>([]);
  const [googleDriveSearch, setGoogleDriveSearch] = useState("");
  const [googleDrivePickerError, setGoogleDrivePickerError] = useState("");
  const [googleDriveSelectedFolderId, setGoogleDriveSelectedFolderId] = useState<string | null>(null);
  const [vaultRenameName, setVaultRenameName] = useState("");
  const [vaultRenameStatus, setVaultRenameStatus] = useState<"idle" | "renaming" | "saved" | "error">("idle");
  const [vaultRenameError, setVaultRenameError] = useState("");
  const pendingHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const displayedVaultPath = nativeVaultPath?.trim() || (vaultHandle ? vaultHandle.name : vaultPath);
  const hasVaultSelection = Boolean(displayedVaultPath.trim());

  useEffect(() => {
    pendingHandleRef.current = vaultHandle;
  }, [vaultHandle]);

  useEffect(() => {
    const detectBridge = () => {
      const bridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
      setNativePickerAvailable(Boolean(bridge?.pickDirectory));
    };

    detectBridge();
    window.addEventListener("brain2-native-bridge-ready", detectBridge);

    return () => {
      window.removeEventListener("brain2-native-bridge-ready", detectBridge);
    };
  }, []);

  useEffect(() => {
    if (!nativePickerAvailable) return;

    const handleNativeVaultSelected = () => {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    };

    window.addEventListener("brain2-native-vault-selected", handleNativeVaultSelected);
    return () => {
      window.removeEventListener("brain2-native-vault-selected", handleNativeVaultSelected);
    };
  }, [nativePickerAvailable]);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (vaultStorageMode !== "google-drive" && vaultStorageMode !== "icloud") {
      return;
    }

    const cloudKey: CloudProvider = vaultStorageMode === "icloud" ? "icloud" : "google-drive";
    const savedDirectory = window.localStorage.getItem(getCloudDirectoryStorageKey(cloudKey)) ?? "";
    const savedDirectoryLabel = window.localStorage.getItem(getCloudDirectoryLabelStorageKey(cloudKey)) ?? "";
    setCloudDirectory(savedDirectory);
    setCloudDirectoryLabel(savedDirectoryLabel);
    setCloudStatus("idle");
    setCloudError("");
    setGoogleDrivePickerOpen(false);
    setGoogleDrivePickerError("");
    setGoogleDriveSearch("");
    setGoogleDriveSelectedFolderId(null);
  }, [vaultStorageMode]);

  useEffect(() => {
    if (!hasVaultSelection) {
      setVaultRenameName("");
      setVaultRenameStatus("idle");
      setVaultRenameError("");
      return;
    }

    setVaultRenameName(extractVaultNameFromPath(displayedVaultPath));
    setVaultRenameStatus("idle");
    setVaultRenameError("");
  }, [displayedVaultPath, hasVaultSelection]);

  useEffect(() => {
    if (!nativePickerAvailable) return;

    const handleNativeRenameResult = (event: Event) => {
      const customEvent = event as CustomEvent<NativeRenameResult>;
      const detail = customEvent.detail;

      if (detail?.success) {
        setVaultRenameStatus("saved");
        setVaultRenameError("");
        setTimeout(() => setVaultRenameStatus("idle"), 2000);
        return;
      }

      setVaultRenameStatus("error");
      setVaultRenameError(detail?.error || "Nao foi possivel renomear o vault.");
    };

    window.addEventListener("brain2-native-vault-rename-result", handleNativeRenameResult);
    return () => {
      window.removeEventListener("brain2-native-vault-rename-result", handleNativeRenameResult);
    };
  }, [nativePickerAvailable]);

  const handleThemeChange = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    if (typeof window === "undefined") {
      return;
    }
    applyThemeToDocument(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  };

  const handlePickDirectory = async () => {
    const nativeBridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
    if (nativeBridge?.pickDirectory) {
      nativeBridge.pickDirectory();
      setStatus("idle");
      return;
    }

    const handle = await pickDirectory();
    if (!handle) return;

    // Selecting does not apply immediately; user confirms via Save button.
    pendingHandleRef.current = handle;
    setVaultPath(handle.name);
    setPasteSaved(false);
    setStatus("idle");
  };

  const handleRemoveVault = async () => {
    if (nativePickerAvailable) {
      setVaultPath("");
      setStatus("idle");
      setPasteSaved(false);
      return;
    }

    await clearDirectoryHandle();
    setVaultPath("");
    pendingHandleRef.current = null;
    onVaultChange(null);
    setStatus("idle");
    setPasteSaved(false);
  };

  const handlePathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVaultPath(e.target.value);
    setPasteSaved(false);
  };

  const handleVaultRenameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVaultRenameName(e.target.value);
    if (vaultRenameStatus !== "idle") {
      setVaultRenameStatus("idle");
      setVaultRenameError("");
    }
  };

  const handlePasteSave = async () => {
    if (!vaultPath.trim()) return;
    const handleToSave = pendingHandleRef.current ?? vaultHandle;
    saveVaultPath(vaultPath.trim());
    if (!handleToSave) {
      setStatus("error");
      return;
    }
    await saveDirectoryHandle(handleToSave);
    onVaultChange(handleToSave);
    setPasteSaved(true);
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  };

  const handleVaultRename = async () => {
    if (!hasVaultSelection) {
      setVaultRenameStatus("error");
      setVaultRenameError("Selecione um vault antes de renomear.");
      return;
    }

    const nextVaultName = vaultRenameName.trim();
    if (!nextVaultName) {
      setVaultRenameStatus("error");
      setVaultRenameError("Digite um nome para o vault.");
      return;
    }

    if (nextVaultName === "." || nextVaultName === ".." || nextVaultName.includes("/") || nextVaultName.includes("\\")) {
      setVaultRenameStatus("error");
      setVaultRenameError("O nome do vault nao pode conter / ou \\\\.");
      return;
    }

    const currentVaultName = extractVaultNameFromPath(displayedVaultPath);
    if (currentVaultName && currentVaultName === nextVaultName) {
      setVaultRenameStatus("saved");
      setVaultRenameError("");
      setTimeout(() => setVaultRenameStatus("idle"), 1200);
      return;
    }

    const nativeBridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
    if (nativePickerAvailable) {
      if (!nativeBridge?.renameVault) {
        setVaultRenameStatus("error");
        setVaultRenameError("Renomeacao nativa indisponivel nesta versao do app.");
        return;
      }

      setVaultRenameStatus("renaming");
      setVaultRenameError("");
      nativeBridge.renameVault({ name: nextVaultName });
      return;
    }

    setVaultRenameStatus("renaming");
    setVaultRenameError("");

    try {
      const response = await fetch("/api/vault", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "rename-vault",
          vaultName: nextVaultName,
        }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Falha ao renomear o vault.");
      }

      setVaultRenameStatus("saved");
      setVaultRenameError("");
      onVaultChange(pendingHandleRef.current ?? vaultHandle ?? null);
      setTimeout(() => setVaultRenameStatus("idle"), 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao renomear o vault.";
      setVaultRenameStatus("error");
      setVaultRenameError(message);
    }
  };

  const handleVaultStorageModeChange = (mode: VaultStorageMode) => {
    setVaultStorageMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CLOUD_PROVIDER_STORAGE_KEY, mode);
    }
    onCloudVaultSaved?.();
  };

  const persistCloudDirectorySelection = (provider: CloudProvider, value: string, label: string) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(getCloudDirectoryStorageKey(provider), value);
    if (label.trim()) {
      window.localStorage.setItem(getCloudDirectoryLabelStorageKey(provider), label.trim());
    } else {
      window.localStorage.removeItem(getCloudDirectoryLabelStorageKey(provider));
    }
    window.localStorage.setItem(CLOUD_PROVIDER_STORAGE_KEY, provider);
  };

  const fetchGoogleDriveFolders = async (interactive = false) => {
    setGoogleDriveLoading(true);
    setGoogleDrivePickerError("");

    try {
      const folders = await listGoogleDriveFolders({
        query: googleDriveSearch,
        interactive,
      });
      setGoogleDriveFolders(folders);
      setGoogleDriveSelectedFolderId((current) => (
        current && folders.some((folder) => folder.id === current) ? current : null
      ));
      setGoogleDrivePickerOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao abrir seletor de pasta do Google Drive.";
      setGoogleDrivePickerError(message);
      setGoogleDrivePickerOpen(true);
    } finally {
      setGoogleDriveLoading(false);
    }
  };

  const handleCloudDirectoryChoose = () => {
    if (vaultStorageMode === "google-drive") {
      void fetchGoogleDriveFolders(true);
      return;
    }

    if (vaultStorageMode !== "icloud") {
      return;
    }

    const selected = window.prompt("Digite o caminho/identificador da pasta no iCloud Drive:", cloudDirectory);
    if (selected === null) {
      return;
    }

    setCloudDirectory(selected.trim());
    setCloudDirectoryLabel("");
    setCloudStatus("idle");
    setCloudError("");
  };

  const handleConfirmGoogleDriveFolder = () => {
    if (!googleDriveSelectedFolderId) {
      setGoogleDrivePickerError("Selecione uma pasta para continuar.");
      return;
    }

    const selectedFolder = googleDriveFolders.find((folder) => folder.id === googleDriveSelectedFolderId);
    if (!selectedFolder) {
      setGoogleDrivePickerError("A pasta selecionada nao foi encontrada. Atualize a lista e tente novamente.");
      return;
    }

    setCloudDirectory(selectedFolder.id);
    setCloudDirectoryLabel(selectedFolder.name);
    setCloudStatus("saved");
    setCloudError("");
    setGoogleDrivePickerOpen(false);
    persistCloudDirectorySelection("google-drive", selectedFolder.id, selectedFolder.name);
    onCloudVaultSaved?.();
    window.setTimeout(() => setCloudStatus("idle"), 1800);
  };

  const handleCloudDirectorySave = () => {
    const rawValue = cloudDirectory.trim();
    if (!rawValue) {
      setCloudStatus("error");
      setCloudError("Informe um diretorio antes de salvar.");
      return;
    }

    let normalizedValue = rawValue;
    let normalizedLabel = cloudDirectoryLabel.trim();
    if (vaultStorageMode === "google-drive") {
      const folderId = parseGoogleDriveFolderId(rawValue);
      if (!folderId) {
        setCloudStatus("error");
        setCloudError("Use um link de pasta do Google Drive valido ou informe o ID da pasta.");
        return;
      }
      normalizedValue = folderId;

      const matchedFolder = googleDriveFolders.find((folder) => folder.id === folderId);
      if (matchedFolder) {
        normalizedLabel = matchedFolder.name;
      }
    }

    const activeCloud: CloudProvider = vaultStorageMode === "icloud" ? "icloud" : "google-drive";
    persistCloudDirectorySelection(activeCloud, normalizedValue, normalizedLabel);

    setCloudDirectory(normalizedValue);
    setCloudDirectoryLabel(normalizedLabel);
    setCloudStatus("saved");
    setCloudError("");
    onCloudVaultSaved?.();
    window.setTimeout(() => setCloudStatus("idle"), 1800);
  };

  const cloudProviderLabel =
    vaultStorageMode === "google-drive" ? "Google Drive" : vaultStorageMode === "icloud" ? "iCloud" : "";
  const cloudDirectoryPlaceholder = vaultStorageMode === "google-drive"
    ? "https://drive.google.com/drive/folders/... ou ID da pasta"
    : "iCloud Drive/Brain2/Vault";
  const selectedGoogleDriveFolder = googleDriveSelectedFolderId
    ? googleDriveFolders.find((folder) => folder.id === googleDriveSelectedFolderId) ?? null
    : null;

  return (
    <div className="settings-root">
      <div className="settings-header">
        <h2>Configurações</h2>
        <button
          className="settings-close"
          onClick={onClose}
          aria-label="Fechar configurações"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="settings-content">
        <section className="settings-section appearance-section">
          <h3>Vault</h3>
          <p className="settings-description">
            Escolha uma origem para os ficheiros <code>.md</code>. Apenas uma opcao fica ativa. Os{" "}
            <code>{"[[wikilinks]]"}</code> alimentam o grafo do Your Brain.
          </p>

          <div className="vault-source-grid" role="radiogroup" aria-label="Origem do vault">
            <button
              type="button"
              role="radio"
              aria-checked={vaultStorageMode === "google-drive"}
              className={`cloud-provider-btn${vaultStorageMode === "google-drive" ? " cloud-provider-btn--active" : ""}`}
              onClick={() => handleVaultStorageModeChange("google-drive")}
            >
              <Cloud size={14} strokeWidth={1.8} />
              <span>Google Drive</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={vaultStorageMode === "icloud"}
              className={`cloud-provider-btn${vaultStorageMode === "icloud" ? " cloud-provider-btn--active" : ""}`}
              onClick={() => handleVaultStorageModeChange("icloud")}
            >
              <Cloud size={14} strokeWidth={1.8} />
              <span>iCloud</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={vaultStorageMode === "local"}
              className={`cloud-provider-btn${vaultStorageMode === "local" ? " cloud-provider-btn--active" : ""}`}
              onClick={() => handleVaultStorageModeChange("local")}
            >
              <FolderOpen size={14} strokeWidth={1.8} />
              <span>Local</span>
            </button>
          </div>

          {vaultStorageMode === "local" && (
            <>
              <p className="settings-description settings-description--tight">
                Pasta no disco: app macOS (seletor Swift) ou navegador (File System Access). Compativel com vaults Obsidian.
              </p>

              {nativePickerAvailable && (
                <div className="native-picker-box">
                  <button className="native-picker-btn" onClick={handlePickDirectory}>
                    Escolher diretório via app Swift
                  </button>
                  <p className="native-picker-hint">
                    Usa o seletor nativo do macOS e atualiza Pastas e Your Brain automaticamente.
                  </p>
                </div>
              )}

              {hasVaultSelection ? (
                <div className="vault-current">
                  <div className="vault-current-info">
                    <FolderOpen size={14} strokeWidth={1.8} />
                    <input
                      className="vault-path-input"
                      type="text"
                      value={displayedVaultPath}
                      placeholder="Caminho do vault"
                      spellCheck={false}
                      readOnly
                    />
                    {status === "saved" && (
                      <span className="vault-saved-badge">
                        <Check size={11} strokeWidth={2} />
                        Salvo
                      </span>
                    )}
                  </div>
                  <div className="vault-current-actions">
                    <button className="vault-change-btn" onClick={handlePickDirectory} type="button">
                      Alterar
                    </button>
                    {!nativePickerAvailable && (
                      <button
                        className="vault-remove-btn"
                        onClick={handleRemoveVault}
                        aria-label="Remover vault"
                        type="button"
                      >
                        <Trash2 size={13} strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="vault-empty">
                  <div className="vault-paste-row">
                    <label className={`vault-paste-field${pasteSaved ? " vault-paste-field--saved" : ""}`}>
                      <button
                        className="vault-folder-icon-btn"
                        type="button"
                        onClick={handlePickDirectory}
                        aria-label="Escolher diretório"
                        title="Escolher diretório"
                      >
                        <FolderOpen size={14} strokeWidth={1.8} />
                      </button>
                      <input
                        type="text"
                        value={vaultPath}
                        onChange={handlePathChange}
                        placeholder="/Users/seu-usuario/Documents/MeuVault"
                        spellCheck={false}
                        readOnly={pasteSaved}
                      />
                    </label>
                    {pasteSaved ? (
                      <button
                        className="vault-paste-saved-btn"
                        type="button"
                        onClick={() => setPasteSaved(false)}
                      >
                        <Check size={13} strokeWidth={2} />
                        Salvo
                      </button>
                    ) : (
                      <button
                        className="vault-paste-save-btn"
                        type="button"
                        onClick={handlePasteSave}
                        disabled={!vaultPath.trim()}
                      >
                        Salvar
                      </button>
                    )}
                  </div>
                  {status === "error" && (
                    <p className="vault-error-hint">Selecione um diretório no icone de pasta antes de salvar.</p>
                  )}
                </div>
              )}

              <div className="vault-rename-box">
                <p className="vault-rename-title">Nome do Vault</p>
                <div className="vault-rename-row">
                  <input
                    className="vault-rename-input"
                    type="text"
                    value={vaultRenameName}
                    onChange={handleVaultRenameChange}
                    placeholder="Novo nome da pasta do vault"
                    spellCheck={false}
                    disabled={!hasVaultSelection || vaultRenameStatus === "renaming"}
                  />
                  <button
                    className="vault-rename-btn"
                    type="button"
                    onClick={() => { void handleVaultRename(); }}
                    disabled={!hasVaultSelection || !vaultRenameName.trim() || vaultRenameStatus === "renaming"}
                  >
                    {vaultRenameStatus === "renaming" ? "Renomeando..." : "Renomear"}
                  </button>
                </div>
                {!hasVaultSelection ? (
                  <p className="vault-hint">Selecione um vault para habilitar a renomeacao.</p>
                ) : vaultRenameStatus === "saved" ? (
                  <p className="vault-success-hint">Nome do vault atualizado com sucesso.</p>
                ) : vaultRenameStatus === "error" ? (
                  <p className="vault-error-hint">{vaultRenameError}</p>
                ) : (
                  <p className="vault-hint">A alteracao atualiza o nome da pasta raiz do vault.</p>
                )}
              </div>
            </>
          )}

          {(vaultStorageMode === "google-drive" || vaultStorageMode === "icloud") && (
            <>
              <p className="settings-description settings-description--tight">
                {vaultStorageMode === "google-drive"
                  ? "A pasta no Google Drive torna-se o vault ativo (menu lateral e Your Brain). Leitura no Drive; gravar conversas no Drive ainda nao esta disponivel."
                  : "Defina a pasta no iCloud Drive. O suporte completo a iCloud na app esta em evolucao."}
              </p>

              <div className="cloud-directory-box">
                <p className="cloud-directory-title">Diretorio em {cloudProviderLabel}</p>
                <div className="cloud-directory-row">
                  <input
                    className="cloud-directory-input"
                    type="text"
                    value={cloudDirectory}
                    onChange={(event) => {
                      setCloudDirectory(event.target.value);
                      if (cloudStatus !== "idle") {
                        setCloudStatus("idle");
                        setCloudError("");
                      }
                    }}
                    placeholder={cloudDirectoryPlaceholder}
                    spellCheck={false}
                  />
                  <button
                    className="cloud-directory-pick-btn"
                    type="button"
                    onClick={handleCloudDirectoryChoose}
                    disabled={googleDriveLoading && vaultStorageMode === "google-drive"}
                  >
                    {googleDriveLoading && vaultStorageMode === "google-drive" ? "Conectando..." : "Escolher diretorio"}
                  </button>
                  <button
                    className="cloud-directory-save-btn"
                    type="button"
                    onClick={handleCloudDirectorySave}
                    disabled={!cloudDirectory.trim()}
                  >
                    Salvar
                  </button>
                </div>

                {vaultStorageMode === "google-drive" && cloudDirectoryLabel.trim() && (
                  <p className="vault-hint">Pasta selecionada: {cloudDirectoryLabel}</p>
                )}

                {cloudStatus === "saved" ? (
                  <p className="vault-success-hint">Configuracao do vault salva com sucesso.</p>
                ) : cloudStatus === "error" ? (
                  <p className="vault-error-hint">{cloudError}</p>
                ) : (
                  <p className="vault-hint">
                    {vaultStorageMode === "google-drive"
                      ? "Use Escolher diretorio para autenticar no Google Drive e selecionar uma pasta privada ou compartilhada."
                      : "Para iCloud, informe o caminho ou identificador da pasta que deseja usar."}
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        {googleDrivePickerOpen && (
          <div
            className="drive-picker-backdrop"
            role="presentation"
            onClick={() => {
              if (!googleDriveLoading) {
                setGoogleDrivePickerOpen(false);
              }
            }}
          >
            <section
              className="drive-picker-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Selecionar pasta do Google Drive"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="drive-picker-header">
                <h4>Selecionar pasta do Google Drive</h4>
                <button
                  className="drive-picker-close-btn"
                  type="button"
                  aria-label="Fechar seletor"
                  onClick={() => setGoogleDrivePickerOpen(false)}
                  disabled={googleDriveLoading}
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>

              <p className="drive-picker-description">
                Entre com sua conta Google para listar pastas, incluindo privadas, e selecionar a pasta do vault.
              </p>

              <div className="drive-picker-search-row">
                <input
                  className="drive-picker-search-input"
                  type="text"
                  value={googleDriveSearch}
                  onChange={(event) => setGoogleDriveSearch(event.target.value)}
                  placeholder="Buscar pasta por nome"
                  spellCheck={false}
                />
                <button
                  className="drive-picker-refresh-btn"
                  type="button"
                  onClick={() => {
                    void fetchGoogleDriveFolders(false);
                  }}
                  disabled={googleDriveLoading}
                >
                  {googleDriveLoading ? "Buscando..." : "Buscar"}
                </button>
              </div>

              {googleDrivePickerError && <p className="vault-error-hint">{googleDrivePickerError}</p>}

              <ul className="drive-picker-folder-list" aria-label="Pastas do Google Drive">
                {googleDriveFolders.length === 0 && !googleDriveLoading ? (
                  <li className="drive-picker-empty">Nenhuma pasta encontrada para esta busca.</li>
                ) : (
                  googleDriveFolders.map((folder) => (
                    <li key={folder.id}>
                      <button
                        className={`drive-picker-folder-item${googleDriveSelectedFolderId === folder.id ? " drive-picker-folder-item--active" : ""}`}
                        type="button"
                        onClick={() => {
                          setGoogleDriveSelectedFolderId(folder.id);
                          setGoogleDrivePickerError("");
                        }}
                      >
                        <span className="drive-picker-folder-name">{folder.name}</span>
                        <span className="drive-picker-folder-id">ID: {folder.id}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>

              <div className="drive-picker-actions">
                <button
                  className="drive-picker-cancel-btn"
                  type="button"
                  onClick={() => setGoogleDrivePickerOpen(false)}
                  disabled={googleDriveLoading}
                >
                  Cancelar
                </button>
                <button
                  className="drive-picker-confirm-btn"
                  type="button"
                  onClick={handleConfirmGoogleDriveFolder}
                  disabled={!selectedGoogleDriveFolder || googleDriveLoading}
                >
                  Usar pasta
                </button>
              </div>
            </section>
          </div>
        )}

        <section className="settings-section appearance-section">
          <h3>Appearance</h3>
          <p className="settings-description">
            Choose how Brain2 looks. Dark mode is the default theme.
          </p>

          <div className="theme-mode-grid" role="radiogroup" aria-label="Appearance theme">
            <button
              type="button"
              role="radio"
              aria-checked={theme === "dark"}
              className={`theme-mode-btn${theme === "dark" ? " theme-mode-btn--active" : ""}`}
              onClick={() => handleThemeChange("dark")}
            >
              Dark mode
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "light"}
              className={`theme-mode-btn${theme === "light" ? " theme-mode-btn--active" : ""}`}
              onClick={() => handleThemeChange("light")}
            >
              Light mode
            </button>
          </div>
        </section>
      </div>

      <style jsx>{`
        .settings-root {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }

        .settings-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 16px;
          border-bottom: 1px solid var(--bar-border);
          flex-shrink: 0;
        }

        .settings-header h2 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 0.04em;
          color: var(--foreground);
        }

        .settings-close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: var(--bar-bg);
          color: var(--muted);
          transition: background 0.15s ease, color 0.15s ease;
        }

        .settings-close:hover {
          background: var(--pill-active);
          color: var(--muted-hover);
        }

        .settings-content {
          flex: 1;
          padding: 24px;
          max-width: 600px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .settings-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .appearance-section {
          padding-top: 18px;
          border-top: 1px solid var(--bar-border);
        }

        .theme-mode-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .vault-source-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .settings-description--tight {
          margin-top: 14px;
          margin-bottom: 0;
        }

        .cloud-provider-btn {
          height: 38px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.03);
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }

        .cloud-provider-btn:hover {
          background: var(--pill-bg);
          border-color: var(--bar-border-hover);
          color: var(--muted-hover);
        }

        .cloud-provider-btn--active {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
          color: var(--foreground);
        }

        .cloud-directory-box {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.02);
        }

        .cloud-directory-title {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--foreground);
          text-transform: uppercase;
        }

        .cloud-directory-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .cloud-directory-input {
          flex: 1;
          height: 36px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.03);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          padding: 0 10px;
          min-width: 0;
        }

        .cloud-directory-pick-btn,
        .cloud-directory-save-btn {
          height: 36px;
          padding: 0 12px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
        }

        .cloud-directory-pick-btn:hover,
        .cloud-directory-save-btn:hover:not(:disabled) {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
        }

        .cloud-directory-save-btn:disabled {
          opacity: 0.45;
        }

        .drive-picker-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.62);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          z-index: 2000;
        }

        .drive-picker-modal {
          width: min(680px, 100%);
          max-height: min(82dvh, 760px);
          border-radius: 14px;
          border: 1px solid var(--bar-border-hover);
          background: #111;
          box-shadow: 0 18px 52px rgba(0, 0, 0, 0.55);
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px;
        }

        .drive-picker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .drive-picker-header h4 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: var(--foreground);
          letter-spacing: 0.02em;
        }

        .drive-picker-close-btn {
          width: 30px;
          height: 30px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: transparent;
          color: var(--muted);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .drive-picker-close-btn:hover:not(:disabled) {
          background: var(--pill-bg);
          color: var(--muted-hover);
        }

        .drive-picker-close-btn:disabled {
          opacity: 0.5;
        }

        .drive-picker-description {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: var(--muted);
          line-height: 1.45;
        }

        .drive-picker-search-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .drive-picker-search-input {
          flex: 1;
          min-width: 0;
          height: 36px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.03);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          padding: 0 10px;
        }

        .drive-picker-refresh-btn {
          height: 36px;
          padding: 0 12px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .drive-picker-refresh-btn:hover:not(:disabled) {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
        }

        .drive-picker-refresh-btn:disabled {
          opacity: 0.45;
        }

        .drive-picker-folder-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow-y: auto;
          min-height: 220px;
          max-height: min(48dvh, 420px);
        }

        .drive-picker-empty {
          border: 1px dashed var(--bar-border);
          border-radius: 10px;
          padding: 12px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--muted);
          text-align: center;
        }

        .drive-picker-folder-item {
          width: 100%;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.02);
          color: var(--foreground);
          padding: 9px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          text-align: left;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .drive-picker-folder-item:hover {
          background: var(--pill-bg);
          border-color: var(--bar-border-hover);
        }

        .drive-picker-folder-item--active {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
        }

        .drive-picker-folder-name {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .drive-picker-folder-id {
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          color: #8b8b8b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .drive-picker-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .drive-picker-cancel-btn,
        .drive-picker-confirm-btn {
          height: 34px;
          padding: 0 12px;
          border-radius: 9px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          border: 1px solid var(--bar-border);
          transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
        }

        .drive-picker-cancel-btn {
          background: transparent;
          color: var(--muted-hover);
        }

        .drive-picker-confirm-btn {
          background: rgba(255, 255, 255, 0.06);
          color: var(--foreground);
        }

        .drive-picker-cancel-btn:hover:not(:disabled),
        .drive-picker-confirm-btn:hover:not(:disabled) {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
        }

        .drive-picker-cancel-btn:disabled,
        .drive-picker-confirm-btn:disabled {
          opacity: 0.45;
        }

        .theme-mode-btn {
          height: 38px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.03);
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }

        .theme-mode-btn:hover {
          background: var(--pill-bg);
          border-color: var(--bar-border-hover);
          color: var(--muted-hover);
        }

        .theme-mode-btn--active {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
          color: var(--foreground);
        }

        @media (max-width: 560px) {
          .vault-source-grid,
          .theme-mode-grid {
            grid-template-columns: 1fr;
          }

          .cloud-directory-row,
          .vault-rename-row {
            flex-direction: column;
            align-items: stretch;
          }

          .cloud-directory-pick-btn,
          .cloud-directory-save-btn,
          .vault-rename-btn,
          .drive-picker-refresh-btn,
          .drive-picker-cancel-btn,
          .drive-picker-confirm-btn {
            width: 100%;
          }

          .drive-picker-modal {
            max-height: 92dvh;
          }

          .drive-picker-search-row,
          .drive-picker-actions {
            flex-direction: column;
            align-items: stretch;
          }
        }

        .native-picker-box {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px 12px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.02);
        }

        .native-picker-btn {
          height: 34px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .native-picker-btn:hover {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
        }

        .native-picker-hint {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: var(--muted);
        }

        .settings-section h3 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--foreground);
        }

        .settings-description {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          line-height: 1.5;
          color: var(--muted);
        }

        .settings-description code {
          background: rgba(255, 255, 255, 0.05);
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 11px;
          color: var(--muted-hover);
        }

        .vault-current {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.02);
        }

        .vault-current-info {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--muted);
          min-width: 0;
          flex: 1;
        }

        .vault-path-input {
          flex: 1;
          border: none;
          background: transparent;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          color: var(--foreground);
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .vault-path-input::placeholder {
          color: #444;
        }

        .vault-path-input:read-only {
          cursor: default;
        }

        .vault-saved-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          color: #48bf84;
          white-space: nowrap;
        }

        .vault-current-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .vault-change-btn {
          height: 28px;
          padding: 0 12px;
          border: 1px solid var(--bar-border);
          border-radius: 8px;
          background: transparent;
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          transition: background 0.15s ease;
        }

        .vault-change-btn:hover {
          background: var(--pill-active);
        }

        .vault-remove-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: 1px solid var(--bar-border);
          border-radius: 8px;
          background: transparent;
          color: var(--muted);
          transition: background 0.15s ease, color 0.15s ease;
        }

        .vault-remove-btn:hover {
          background: rgba(220, 60, 60, 0.1);
          color: #dc3c3c;
        }

        .vault-empty {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .vault-paste-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .vault-paste-field {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 0;
          height: 40px;
          border-radius: 10px;
          border: 1px solid var(--bar-border);
          background: rgba(255, 255, 255, 0.02);
          padding: 0 12px 0 0;
          color: var(--muted);
          transition: border-color 0.15s ease, opacity 0.3s ease;
        }

        .vault-paste-field--saved {
          opacity: 0.45;
        }

        .vault-paste-field:focus-within {
          border-color: var(--bar-border-hover);
        }

        .vault-folder-icon-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 38px;
          border: none;
          border-radius: 9px 0 0 9px;
          background: transparent;
          color: var(--muted);
          flex-shrink: 0;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .vault-folder-icon-btn:hover {
          background: var(--pill-active);
          color: var(--foreground);
        }

        .vault-paste-field input {
          flex: 1;
          border: none;
          background: transparent;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--foreground);
          min-width: 0;
        }

        .vault-paste-field input::placeholder {
          color: #444;
        }

        .vault-paste-save-btn {
          height: 40px;
          padding: 0 16px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          flex-shrink: 0;
          transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
        }

        .vault-paste-save-btn:hover:not(:disabled) {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
        }

        .vault-paste-save-btn:disabled {
          opacity: 0.35;
        }

        .vault-paste-saved-btn {
          height: 40px;
          padding: 0 14px;
          border: 1px solid rgba(72, 191, 132, 0.2);
          border-radius: 10px;
          background: transparent;
          color: #48bf84;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
          flex-shrink: 0;
          transition: background 0.15s ease;
        }

        .vault-paste-saved-btn:hover {
          background: rgba(72, 191, 132, 0.06);
        }

        .vault-error-hint {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #c67878;
        }

        .vault-hint {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #444;
        }

        .vault-hint code {
          background: rgba(255, 255, 255, 0.03);
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 10px;
          color: #555;
        }

        .vault-rename-box {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.02);
        }

        .vault-rename-title {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--foreground);
          text-transform: uppercase;
        }

        .vault-rename-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .vault-rename-input {
          flex: 1;
          height: 36px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.03);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          padding: 0 10px;
          min-width: 0;
        }

        .vault-rename-input:disabled {
          opacity: 0.5;
        }

        .vault-rename-btn {
          height: 36px;
          padding: 0 14px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
        }

        .vault-rename-btn:hover:not(:disabled) {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
        }

        .vault-rename-btn:disabled {
          opacity: 0.45;
        }

        .vault-success-hint {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #48bf84;
        }

      `}</style>
    </div>
  );
}
