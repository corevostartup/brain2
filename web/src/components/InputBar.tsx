"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { flushSync } from "react-dom";
import {
  Plus,
  Mic,
  MicOff,
  ArrowUp,
  Key,
  ChevronDown,
  BrainCircuit,
} from "lucide-react";
import { loadLlmConfig, type LlmClientConfig } from "@/lib/llmClientConfig";
import {
  getSpeechRecognitionConstructor,
  getDefaultLiveTranscriptionTiming,
  startLiveTranscription,
} from "@/lib/browserSpeechRecognition";

type Mode = "Ask" | "Agent";
type ContextMode = "Local" | "API";

const MODES: Mode[] = ["Ask", "Agent"];
const CONTEXT_MODES: ContextMode[] = ["Local", "API"];
const LLM_STORAGE_KEY = "brain2-llm-config";
const LLM_MODEL_STORAGE_KEY = "brain2-llm-model";
const LLM_API_KEY_STORAGE_KEY = "brain2-llm-api-key";

type NativeBridge = {
  llmConfig?: {
    model?: string;
    apiKey?: string;
  };
  saveLlmConfig?: (payload: { model: string; apiKey: string }) => void;
  clearLlmConfig?: () => void;
};

function maskApiKey(key: string): string {
  if (!key) return "não configurada";
  if (key.length <= 8) {
    return `${key.slice(0, 2)}****`;
  }
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function isBrain2NativeShell(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.hasAttribute("data-brain2-native");
}

type InputBarProps = {
  desktopSidebarOffset?: boolean;
  isSending?: boolean;
  assistantDisplayName?: string | null;
  onSend?: (payload: { content: string; model: string; apiKey: string }) => Promise<void>;
  onOpenAdvancedVoice?: () => void;
};

export default function InputBar({
  desktopSidebarOffset = false,
  isSending = false,
  assistantDisplayName: assistantDisplayNameProp,
  onSend,
  onOpenAdvancedVoice,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const [activeMode, setActiveMode] = useState<Mode>("Ask");
  const [activeContextMode, setActiveContextMode] = useState<ContextMode>("Local");
  const [isLlmConfigOpen, setIsLlmConfigOpen] = useState(false);
  const [llmModel, setLlmModel] = useState("gpt-5.4-mini");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [draftModel, setDraftModel] = useState("gpt-5.4-mini");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [llmStatus, setLlmStatus] = useState<"idle" | "error" | "saved">("idle");
  const [isDictating, setIsDictating] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef("");
  const stopDictationRef = useRef<(() => void) | null>(null);
  const dictationPrefixRef = useRef("");

  const hasConfiguredApiKey = llmApiKey.trim().length > 0;

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const stopDictation = useCallback(() => {
    if (stopDictationRef.current) {
      stopDictationRef.current();
      stopDictationRef.current = null;
    }
    setIsDictating(false);
  }, []);

  useEffect(() => {
    if (!isLlmConfigOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsLlmConfigOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLlmConfigOpen]);

  useEffect(() => {
    const syncFromNative = () => {
      const saved = loadLlmConfig();
      if (!saved) return;
      setLlmModel(saved.model);
      setLlmApiKey(saved.apiKey);
    };

    window.addEventListener("brain2-native-bridge-ready", syncFromNative);
    const timer = window.setTimeout(syncFromNative, 0);

    return () => {
      window.removeEventListener("brain2-native-bridge-ready", syncFromNative);
      window.clearTimeout(timer);
    };
  }, []);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, []);

  const toggleDictation = useCallback(() => {
    if (stopDictationRef.current) {
      stopDictation();
      setSttError(null);
      return;
    }
    if (!getSpeechRecognitionConstructor()) {
      setSttError("Reconhecimento de voz indisponível neste browser. Use Chrome ou Safari recente.");
      return;
    }
    setSttError(null);
    dictationPrefixRef.current = valueRef.current;
    const timing = getDefaultLiveTranscriptionTiming();
    const stop = startLiveTranscription(
      {
        onText: (text) => {
          const spoken = text.trim();
          const prefix = dictationPrefixRef.current;
          const join = prefix && spoken ? (/\s$/.test(prefix) ? "" : " ") : "";
          setValue(prefix + join + spoken);
          queueMicrotask(() => autoResize());
        },
        onError: (code) => {
          if (code === "denied") {
            setSttError("Permissão de microfone ou voz recusada.");
          } else if (code === "unsupported") {
            setSttError("Reconhecimento de voz não suportado.");
          } else if (!isBrain2NativeShell()) {
            setSttError("Reconhecimento interrompido. Tente de novo.");
          }
          stopDictation();
        },
      },
      {
        lang: "pt-BR",
        webkitStableMode: timing.webkitStableMode,
        startDelayMs: isBrain2NativeShell() ? Math.max(timing.startDelayMs, 680) : timing.startDelayMs,
      },
    );
    stopDictationRef.current = stop;
    setIsDictating(true);
  }, [stopDictation, autoResize]);

  useEffect(() => {
    return () => {
      if (stopDictationRef.current) {
        stopDictationRef.current();
        stopDictationRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isSending) {
      stopDictation();
    }
  }, [isSending, stopDictation]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    autoResize();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (isSending) return;
    stopDictation();
    setSttError(null);
    const trimmed = value.trim();
    if (!trimmed) return;

    if (!llmModel.trim() || !llmApiKey.trim()) {
      setLlmStatus("error");
      openLlmConfig();
      return;
    }

    const model = llmModel.trim();
    const apiKey = llmApiKey.trim();

    // Limpar já no Enter/clique — não esperar pelo `await` do envio (evita texto “preso” na caixa).
    flushSync(() => {
      setValue("");
    });
    autoResize();

    if (onSend) {
      try {
        await onSend({
          content: trimmed,
          model,
          apiKey,
        });
      } catch {
        /* Erro já reflectido em setChatError dentro de handleSendToBrain */
      }
    }
  };

  const openLlmConfig = () => {
    setDraftModel(llmModel);
    setDraftApiKey(llmApiKey);
    setLlmStatus("idle");
    setIsLlmConfigOpen(true);
  };

  const saveLlmConfig = () => {
    const nextModel = draftModel.trim();
    const nextApiKey = draftApiKey.trim();
    if (!nextModel || !nextApiKey) {
      setLlmStatus("error");
      return;
    }

    const nextConfig: LlmClientConfig = {
      model: nextModel,
      apiKey: nextApiKey,
    };

    localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(nextConfig));
    localStorage.setItem(LLM_MODEL_STORAGE_KEY, nextModel);
    localStorage.setItem(LLM_API_KEY_STORAGE_KEY, nextApiKey);

    const nativeBridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
    nativeBridge?.saveLlmConfig?.({ model: nextModel, apiKey: nextApiKey });

    setLlmModel(nextModel);
    setLlmApiKey(nextApiKey);
    setLlmStatus("saved");
    setIsLlmConfigOpen(false);
  };

  const clearLlmConfig = () => {
    localStorage.removeItem(LLM_STORAGE_KEY);
    localStorage.removeItem(LLM_MODEL_STORAGE_KEY);
    localStorage.removeItem(LLM_API_KEY_STORAGE_KEY);

    const nativeBridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
    nativeBridge?.clearLlmConfig?.();

    setLlmApiKey("");
    setLlmModel("gpt-5.4-mini");
    setDraftModel("gpt-5.4-mini");
    setDraftApiKey("");
    setLlmStatus("idle");
  };

  const canSend = value.trim().length > 0;

  return (
    <>
      <div
        className={`input-bar-wrapper${desktopSidebarOffset ? " input-bar-wrapper--with-sidebar" : ""}`}
      >
        <div className="input-bar">
        {/* ── Desktop: single row ── */}
        <div className="bar-inner">
          {/* Left actions */}
          <div className="left-actions">
            <button className="icon-btn" aria-label="Adicionar arquivo">
              <Plus size={15} strokeWidth={1.8} />
            </button>

            <div className="mode-selector" role="radiogroup" aria-label="Modo">
              {MODES.map((m) => (
                <button
                  key={m}
                  className={`mode-option${activeMode === m ? " mode-option--active" : ""}`}
                  onClick={() => setActiveMode(m)}
                  role="radio"
                  aria-checked={activeMode === m}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="mode-selector context-selector" role="radiogroup" aria-label="Contexto">
              {CONTEXT_MODES.map((m) => (
                <button
                  key={m}
                  className={`mode-option${activeContextMode === m ? " mode-option--active" : ""}`}
                  onClick={() => setActiveContextMode(m)}
                  role="radio"
                  aria-checked={activeContextMode === m}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <textarea
            ref={textareaRef}
            className="main-input"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isDictating
                ? "À escuta… fale para transcrever."
                : `Pergunte a ${assistantDisplayNameProp?.trim() ? assistantDisplayNameProp.trim() : "Brain2"}…`
            }
            rows={1}
            spellCheck={false}
            aria-label="Mensagem"
          />

          {/* Right actions */}
          <div className="right-actions">
            <button className="icon-btn hidden-mobile" aria-label="Modelo de IA">
              <BrainCircuit size={15} strokeWidth={1.5} />
            </button>

            <button className="model-btn hidden-mobile" aria-label="Selecionar modelo" onClick={openLlmConfig}>
              <span>{llmModel}</span>
              <ChevronDown size={12} strokeWidth={1.8} />
            </button>

            <button
              className={`icon-btn${hasConfiguredApiKey ? " icon-btn--configured" : ""}`}
              aria-label="Chave de API"
              title={hasConfiguredApiKey ? `API key: ${maskApiKey(llmApiKey)}` : "Configurar API key"}
              onClick={openLlmConfig}
            >
              <Key size={14} strokeWidth={1.8} />
            </button>

            <button
              className={`icon-btn${isDictating ? " icon-btn--dictating" : ""}`}
              type="button"
              aria-label={isDictating ? "Parar ditado por voz" : "Falar para transcrever"}
              aria-pressed={isDictating}
              title={isDictating ? "Parar microfone" : "Falar — transcreve no campo de texto"}
              onClick={() => toggleDictation()}
            >
              {isDictating ? <MicOff size={15} strokeWidth={1.8} /> : <Mic size={15} strokeWidth={1.8} />}
            </button>

            <button
              className="icon-btn voice-advanced-btn"
              aria-label="Conversa avançada com voz"
              title="Conversa avançada (voz + cérebro)"
              type="button"
              onClick={() => {
                stopDictation();
                setSttError(null);
                onOpenAdvancedVoice?.();
              }}
            >
              <span className="voice-bars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
            </button>

            <button
              className={`send-btn${canSend ? " send-btn--active" : ""}`}
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!canSend || isSending}
              aria-label="Enviar mensagem"
            >
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {sttError ? (
          <p className="input-bar-stt-error" role="alert">
            {sttError}
          </p>
        ) : null}
      </div>
      </div>

      {isLlmConfigOpen && (
        <div className="llm-modal-overlay" onClick={() => setIsLlmConfigOpen(false)}>
          <div
            className="llm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Configurar modelo LLM"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Adicionar modelo LLM</h3>
            <p className="llm-modal-description">
              Defina o modelo e a chave da API para usar no Brain2.
            </p>

            <label className="llm-field">
              <span>Modelo</span>
              <input
                type="text"
                value={draftModel}
                onChange={(event) => {
                  setDraftModel(event.target.value);
                  if (llmStatus !== "idle") setLlmStatus("idle");
                }}
                placeholder="ex: gpt-4o-mini, claude-3-7-sonnet"
                spellCheck={false}
              />
            </label>

            <label className="llm-field">
              <span>API key</span>
              <input
                type="password"
                value={draftApiKey}
                onChange={(event) => {
                  setDraftApiKey(event.target.value);
                  if (llmStatus !== "idle") setLlmStatus("idle");
                }}
                placeholder="sk-..."
                spellCheck={false}
              />
            </label>

            {llmStatus === "error" && (
              <p className="llm-status llm-status--error">
                Preencha modelo e API key para salvar.
              </p>
            )}

            <div className="llm-actions">
              <button className="llm-btn llm-btn--ghost" onClick={() => setIsLlmConfigOpen(false)}>
                Cancelar
              </button>
              <button className="llm-btn llm-btn--ghost" onClick={clearLlmConfig}>
                Limpar
              </button>
              <button className="llm-btn llm-btn--primary" onClick={saveLlmConfig}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .input-bar-wrapper {
          position: fixed;
          bottom: env(safe-area-inset-bottom);
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          width: 100vw;
          padding: 44px 16px max(28px, env(safe-area-inset-bottom));
          background: linear-gradient(
            to top,
            rgba(12, 12, 12, 1) 68%,
            rgba(12, 12, 12, 0.55) 84%,
            rgba(12, 12, 12, 0)
          );
          pointer-events: none;
          z-index: 1000;
          transition: bottom 0.15s ease-out;
        }

        :global(html[data-theme="light"]) .input-bar-wrapper,
        :global(body[data-theme="light"]) .input-bar-wrapper {
          background: linear-gradient(
            to top,
            rgba(244, 245, 247, 1) 68%,
            rgba(244, 245, 247, 0.78) 84%,
            rgba(244, 245, 247, 0)
          );
        }

        @media (min-width: 980px) {
          .input-bar-wrapper {
            padding: 56px 16px max(28px, env(safe-area-inset-bottom));
            background: linear-gradient(
              to top,
              rgba(12, 12, 12, 1) 62%,
              rgba(12, 12, 12, 0.55) 80%,
              rgba(12, 12, 12, 0)
            );
          }

          :global(html[data-theme="light"]) .input-bar-wrapper,
          :global(body[data-theme="light"]) .input-bar-wrapper {
            background: linear-gradient(
              to top,
              rgba(244, 245, 247, 1) 62%,
              rgba(244, 245, 247, 0.78) 80%,
              rgba(244, 245, 247, 0)
            );
          }

          .input-bar-wrapper--with-sidebar {
            left: var(--desktop-sidebar-width);
            right: auto;
            width: calc(100vw - var(--desktop-sidebar-width));
          }
        }

        .input-bar {
          width: min(780px, calc(100% - 32px));
          background: var(--bar-bg);
          border: 1px solid var(--bar-border);
          border-radius: 18px;
          pointer-events: all;
          transition: border-color 0.2s ease;
        }

        .input-bar:focus-within {
          border-color: var(--bar-border-hover);
        }

        .bar-inner {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 10px 12px 8px 10px;
        }

        /* ── Left ── */
        .left-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        /* ── Input ── */
        .main-input {
          order: -1;
          width: 100%;
          flex: 0 0 100%;
          background: transparent;
          border: none;
          resize: none;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 400;
          line-height: 1.6;
          color: var(--foreground);
          min-height: 24px;
          max-height: 180px;
          overflow-y: auto;
          padding: 0 4px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.08) transparent;
        }

        .main-input::placeholder {
          color: var(--muted);
          font-weight: 300;
        }

        /* ── Right ── */
        .right-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
          margin-left: auto;
        }

        /* ── Shared buttons ── */
        .icon-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          transition: color 0.15s ease, background 0.15s ease;
        }

        .icon-btn:hover {
          color: var(--muted-hover);
          background: var(--pill-active);
        }

        .icon-btn--configured {
          color: #48bf84;
        }

        .icon-btn--configured:hover {
          color: #61d79b;
          background: rgba(72, 191, 132, 0.12);
        }

        .icon-btn--dictating {
          color: #4a9eff;
          background: rgba(74, 158, 255, 0.12);
        }

        .icon-btn--dictating:hover {
          background: rgba(74, 158, 255, 0.18);
        }

        .input-bar-stt-error {
          margin: 0;
          padding: 6px 14px 10px;
          font-size: 12px;
          line-height: 1.35;
          color: #c45a5a;
        }

        :global(html[data-theme="light"]) .input-bar-stt-error,
        :global(body[data-theme="light"]) .input-bar-stt-error {
          color: #b04040;
        }

        .voice-advanced-btn {
          padding: 0;
        }

        .voice-bars {
          width: 14px;
          height: 14px;
          display: inline-flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 2px;
        }

        .voice-bars span {
          display: block;
          width: 2px;
          border-radius: 2px;
          background: currentColor;
          opacity: 0.95;
          transition: transform 0.15s ease, opacity 0.15s ease;
        }

        .voice-bars span:nth-child(1) {
          height: 5px;
        }

        .voice-bars span:nth-child(2) {
          height: 10px;
        }

        .voice-bars span:nth-child(3) {
          height: 7px;
        }

        .voice-bars span:nth-child(4) {
          height: 12px;
        }

        .voice-advanced-btn:hover .voice-bars span {
          transform: translateY(-1px);
          opacity: 1;
        }

        /* ── Mode pills ── */
        .mode-selector {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 28px;
          border: 1px solid var(--bar-border);
          border-radius: 8px;
          padding: 1px;
          background: var(--pill-bg);
        }

        .mode-option {
          display: flex;
          align-items: center;
          height: 26px;
          padding: 0 9px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 400;
          letter-spacing: 0.01em;
          cursor: pointer;
          white-space: nowrap;
          transition: color 0.15s ease, background 0.15s ease;
        }

        .mode-option:hover {
          color: var(--muted-hover);
          background: var(--pill-bg);
        }

        .mode-option--active {
          color: var(--foreground);
          background: var(--pill-active);
          font-weight: 500;
        }

        @media (max-width: 979px) {
          .context-selector {
            display: none;
          }
        }

        /* ── Model button ── */
        .model-btn {
          display: flex;
          align-items: center;
          gap: 3px;
          height: 26px;
          padding: 0 8px;
          border-radius: 7px;
          border: none;
          background: transparent;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 11.5px;
          font-weight: 400;
          letter-spacing: 0.01em;
          cursor: pointer;
          white-space: nowrap;
          transition: color 0.15s ease, background 0.15s ease;
        }

        .model-btn:hover {
          color: var(--muted-hover);
          background: var(--pill-bg);
        }

        /* ── Send button ── */
        .send-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 8px;
          border: none;
          background: var(--send-bg);
          color: var(--muted);
          cursor: pointer;
          transition: color 0.15s ease, background 0.15s ease;
          flex-shrink: 0;
        }

        .send-btn--active {
          background: var(--foreground);
          color: var(--background);
        }

        .send-btn--active:hover {
          background: var(--muted-hover);
        }

        .send-btn:disabled {
          cursor: default;
        }

        .llm-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1400;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }

        .llm-modal {
          width: min(460px, 100%);
          border: 1px solid var(--bar-border);
          border-radius: 14px;
          background: var(--bar-bg);
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .llm-modal h3 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: var(--foreground);
        }

        .llm-modal-description {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--muted);
          line-height: 1.45;
        }

        .llm-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .llm-field span {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: var(--muted);
          letter-spacing: 0.02em;
        }

        .llm-field input {
          height: 38px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: var(--pill-bg);
          color: var(--foreground);
          padding: 0 12px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
        }

        .llm-field input:focus {
          border-color: var(--bar-border-hover);
        }

        .llm-status {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
        }

        .llm-status--error {
          color: #c67878;
        }

        .llm-actions {
          margin-top: 4px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
        }

        .llm-btn {
          height: 34px;
          border-radius: 9px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          padding: 0 12px;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .llm-btn--ghost {
          border: 1px solid var(--bar-border);
          color: var(--muted);
          background: transparent;
        }

        .llm-btn--ghost:hover {
          color: var(--muted-hover);
          background: var(--pill-bg);
        }

        .llm-btn--primary {
          border: 1px solid var(--bar-border-hover);
          color: var(--background);
          background: var(--foreground);
          font-weight: 500;
        }

        .llm-btn--primary:hover {
          background: var(--muted-hover);
        }

        /* ── Mobile ── */
        @media (max-width: 600px) {
          .input-bar-wrapper {
            padding: 26px 12px 24px;
          }

          .hidden-mobile {
            display: none;
          }

          .bar-inner {
            gap: 6px;
            padding: 10px 10px 8px;
          }

          .left-actions {
            flex: 1;
          }
        }
      `}</style>
    </>
  );
}
