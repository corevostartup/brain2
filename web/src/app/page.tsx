"use client";

import { useState } from "react";
import InputBar from "@/components/InputBar";
import DesktopSidebar from "@/components/DesktopSidebar";
import { PanelLeftOpen } from "lucide-react";

export default function Home() {
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

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
      {!isSidebarHidden && <DesktopSidebar onHide={() => setIsSidebarHidden(true)} />}

      {isMobileSidebarOpen && (
        <DesktopSidebar onHide={() => setIsMobileSidebarOpen(false)} mobileFullscreen />
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

      {/* Welcome area */}
      <section
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          height: "calc(100dvh - 120px)",
          userSelect: "none",
          pointerEvents: "none",
          padding: "0 20px",
        }}
      >
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
      </section>

      {/* Bottom input bar */}
      {!isMobileSidebarOpen && <InputBar desktopSidebarOffset={!isSidebarHidden} />}

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

