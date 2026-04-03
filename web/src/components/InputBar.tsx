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

type Mode = "Ask" | "Agent" | "Local" | "API";

const MODES: Mode[] = ["Ask", "Agent", "Local", "API"];

export default function InputBar() {
  const [value, setValue] = useState("");
  const [activeMode, setActiveMode] = useState<Mode>("Ask");
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
    <div className="input-bar-wrapper">
      <div className="input-bar">
        {/* ── Desktop: single row ── */}
        <div className="bar-inner">
          {/* Left actions */}
          <div className="left-actions">
            <button className="icon-btn" aria-label="Adicionar arquivo">
              <Plus size={15} strokeWidth={1.8} />
            </button>

            <div className="mode-pills" role="group" aria-label="Modo">
              {MODES.map((m) => (
                <button
                  key={m}
                  className={`pill${activeMode === m ? " pill--active" : ""}`}
                  onClick={() => setActiveMode(m)}
                  aria-pressed={activeMode === m}
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
          bottom: 0;
          left: 0;
          right: 0;
          width: 100vw;
          padding: 16px 16px calc(28px + env(safe-area-inset-bottom));
          background: linear-gradient(
            to top,
            rgba(12, 12, 12, 1) 60%,
            rgba(12, 12, 12, 0)
          );
          pointer-events: none;
          z-index: 1000;
        }

        .input-bar {
          max-width: 780px;
          width: calc(100% - 32px);
          margin: 0 auto;
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
          gap: 8px;
          padding: 10px 12px 10px 10px;
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
          flex: 1;
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
        .mode-pills {
          display: flex;
          align-items: center;
          gap: 2px;
        }

        .pill {
          display: flex;
          align-items: center;
          height: 26px;
          padding: 0 9px;
          border-radius: 7px;
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

        .pill:hover {
          color: var(--muted-hover);
          background: var(--pill-bg);
        }

        .pill--active {
          color: var(--foreground);
          background: var(--pill-active);
          font-weight: 500;
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
            flex-wrap: wrap;
            gap: 6px;
            padding: 10px 10px 8px;
          }

          .main-input {
            order: -1;
            width: 100%;
            flex-basis: 100%;
          }

          .left-actions {
            flex: 1;
          }

          .right-actions {
            margin-left: auto;
          }
        }
      `}</style>
    </div>
  );
}
