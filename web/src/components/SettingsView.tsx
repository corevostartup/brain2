"use client";

import { useState, useEffect } from "react";
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
};

export default function SettingsView({ onClose, onVaultChange, vaultHandle }: SettingsViewProps) {
  const [vaultPath, setVaultPath] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pasteSaved, setPasteSaved] = useState(false);

  useEffect(() => {
    // Load saved path from localStorage
    const stored = loadVaultPath();
    if (stored) {
      setVaultPath(stored);
    } else if (vaultHandle) {
      setVaultPath(vaultHandle.name);
    }
  }, [vaultHandle]);

  const handlePickDirectory = async () => {
    const handle = await pickDirectory();
    if (!handle) return;

    await saveDirectoryHandle(handle);
    // resolve() to get full path is not available in browsers,
    // so we save the handle.name + let user see/edit the path
    const path = handle.name;
    saveVaultPath(path);
    setVaultPath(path);
    onVaultChange(handle);
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  };

  const handleRemoveVault = async () => {
    await clearDirectoryHandle();
    setVaultPath("");
    onVaultChange(null);
    setStatus("idle");
  };

  const handlePathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVaultPath(e.target.value);
    setPasteSaved(false);
  };

  const handlePasteSave = async () => {
    if (!vaultPath.trim()) return;
    saveVaultPath(vaultPath.trim());
    setPasteSaved(true);
  };

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

          {vaultHandle ? (
            <div className="vault-current">
              <div className="vault-current-info">
                <FolderOpen size={14} strokeWidth={1.8} />
                <input
                  className="vault-path-input"
                  type="text"
                  value={vaultPath}
                  onChange={handlePathChange}
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
                <button
                  className="vault-remove-btn"
                  onClick={handleRemoveVault}
                  aria-label="Remover vault"
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          ) : (
            <div className="vault-empty">
              <button
                className="vault-pick-btn"
                onClick={handlePickDirectory}
              >
                <FolderOpen size={14} strokeWidth={1.8} />
                Escolher diretório do Vault
              </button>
              <div className="vault-or">ou cole o caminho abaixo</div>
              <div className="vault-paste-row">
                <label className={`vault-paste-field${pasteSaved ? " vault-paste-field--saved" : ""}`}>
                  <FolderOpen size={14} strokeWidth={1.8} />
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

        .vault-pick-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 40px;
          padding: 0 16px;
          border: 1px dashed var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.02);
          color: var(--foreground);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .vault-pick-btn:hover {
          background: var(--pill-active);
          border-color: var(--bar-border-hover);
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

        .vault-or {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #444;
          text-align: center;
          letter-spacing: 0.04em;
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
          gap: 8px;
          height: 40px;
          border-radius: 10px;
          border: 1px solid var(--bar-border);
          background: rgba(255, 255, 255, 0.02);
          padding: 0 12px;
          color: var(--muted);
          transition: border-color 0.15s ease, opacity 0.3s ease;
        }

        .vault-paste-field--saved {
          opacity: 0.45;
        }

        .vault-paste-field:focus-within {
          border-color: var(--bar-border-hover);
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
