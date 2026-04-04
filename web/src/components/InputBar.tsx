"use client";

import { useRef, useState, useCallback } from "react";
import {
  Plus,
  Mic,
  ArrowUp,
  Key,
  ChevronDown,
  BrainCircuit,
} from "lucide-react";

type Mode = "Ask" | "Agent";
type ContextMode = "Local" | "API";

const MODES: Mode[] = ["Ask", "Agent"];
const CONTEXT_MODES: ContextMode[] = ["Local", "API"];

type InputBarProps = {
  desktopSidebarOffset?: boolean;
};

export default function InputBar({ desktopSidebarOffset = false }: InputBarProps) {
  const [value, setValue] = useState("");
  const [activeMode, setActiveMode] = useState<Mode>("Ask");
  const [activeContextMode, setActiveContextMode] = useState<ContextMode>("Local");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    autoResize();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!value.trim()) return;
    // TODO: connect to API
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const canSend = value.trim().length > 0;

  return (
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
            placeholder="Pergunte ao Brain2…"
            rows={1}
            spellCheck={false}
            aria-label="Mensagem"
          />

          {/* Right actions */}
          <div className="right-actions">
            <button className="icon-btn hidden-mobile" aria-label="Modelo de IA">
              <BrainCircuit size={15} strokeWidth={1.5} />
            </button>

            <button className="model-btn hidden-mobile" aria-label="Selecionar modelo">
              <span>gpt-5.4-mini</span>
              <ChevronDown size={12} strokeWidth={1.8} />
            </button>

            <button className="icon-btn hidden-mobile" aria-label="Chave de API">
              <Key size={14} strokeWidth={1.8} />
            </button>

            <button className="icon-btn" aria-label="Entrada de voz">
              <Mic size={15} strokeWidth={1.8} />
            </button>

            <button
              className={`send-btn${canSend ? " send-btn--active" : ""}`}
              onClick={handleSubmit}
              disabled={!canSend}
              aria-label="Enviar mensagem"
            >
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .input-bar-wrapper {
          position: fixed;
          bottom: env(safe-area-inset-bottom);
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          width: 100vw;
          padding: 16px 16px max(28px, env(safe-area-inset-bottom));
          background: linear-gradient(
            to top,
            rgba(12, 12, 12, 1) 70%,
            rgba(12, 12, 12, 0.5) 85%,
            rgba(12, 12, 12, 0)
          );
          pointer-events: none;
          z-index: 1000;
          transition: bottom 0.15s ease-out;
        }

        @media (min-width: 980px) {
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

        /* ── Mode pills ── */
        .mode-selector {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 28px;
          border: 1px solid var(--bar-border);
          border-radius: 8px;
          padding: 1px;
          background: rgba(255, 255, 255, 0.02);
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
          background: rgba(255, 255, 255, 0.88);
          color: #0c0c0c;
        }

        .send-btn--active:hover {
          background: rgba(255, 255, 255, 1);
        }

        .send-btn:disabled {
          cursor: default;
        }

        /* ── Mobile ── */
        @media (max-width: 600px) {
          .input-bar-wrapper {
            padding: 12px 12px 24px;
          }

          .hidden-mobile {
            display: none;
          }

          .bar-inner {
            gap: 6px;
            padding: 10px 10px 8px;
          }

          .main-input {
          }

          .left-actions {
            flex: 1;
          }
        }
      `}</style>
    </div>
  );
}
