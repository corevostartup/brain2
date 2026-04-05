"use client";

import { useState, useEffect, useRef } from "react";
import { X, FolderOpen, Check, Trash2 } from "lucide-react";
import {
  pickDirectory,
  saveDirectoryHandle,
  clearDirectoryHandle,
  saveVaultPath,
  loadVaultPath,
} from "@/lib/vault";

type SettingsViewProps = {
  onClose: () => void;
  onVaultChange: (handle: FileSystemDirectoryHandle | null) => void;
  vaultHandle: FileSystemDirectoryHandle | null;
  nativeVaultPath?: string;
};

type NativeBridge = {
  isAvailable?: boolean;
  pickDirectory?: () => void;
};

export default function SettingsView({ onClose, onVaultChange, vaultHandle, nativeVaultPath }: SettingsViewProps) {
  const [vaultPath, setVaultPath] = useState<string>(() => (
    typeof window === "undefined" ? "" : (loadVaultPath() ?? "")
  ));
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pasteSaved, setPasteSaved] = useState(false);
  const [nativePickerAvailable, setNativePickerAvailable] = useState(false);
  const pendingHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

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

  const displayedVaultPath = nativeVaultPath?.trim() || (vaultHandle ? vaultHandle.name : vaultPath);
  const hasVaultSelection = Boolean(displayedVaultPath.trim());

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
        <section className="settings-section">
          <h3>Vault</h3>
          <p className="settings-description">
            Escolha o diretório onde seus arquivos <code>.md</code> (Markdown) estão armazenados.
            As conexões <code>{"[[wikilinks]]"}</code> serão usadas para gerar o grafo do Your Brain.
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
                <button
                  className="vault-change-btn"
                  onClick={handlePickDirectory}
                >
                  Alterar
                </button>
                {!nativePickerAvailable && (
                  <button
                    className="vault-remove-btn"
                    onClick={handleRemoveVault}
                    aria-label="Remover vault"
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
                    onClick={() => setPasteSaved(false)}
                  >
                    <Check size={13} strokeWidth={2} />
                    Salvo
                  </button>
                ) : (
                  <button
                    className="vault-paste-save-btn"
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

          <p className="vault-hint">
            Compatível com vaults do Obsidian e qualquer pasta com arquivos <code>.md</code>.
          </p>
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
        }

        .settings-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
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
      `}</style>
    </div>
  );
}
