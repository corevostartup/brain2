"use client";

import { useCallback, useState } from "react";

export const WEB_DIRECTORY_ONBOARDING_KEY = "brain2-web-directory-onboarding-completed";

type Step = "directory" | "brain";

type WebDirectoryOnboardingProps = {
  onCompleted: () => void;
};

/**
 * Onboarding no browser (sem shell nativo). O fluxo no Mac continua a ser o overlay Swift.
 */
export function WebDirectoryOnboarding({ onCompleted }: WebDirectoryOnboardingProps) {
  const [step, setStep] = useState<Step>("directory");
  const [displayName, setDisplayName] = useState("");

  const persistAndClose = useCallback(() => {
    try {
      localStorage.setItem(WEB_DIRECTORY_ONBOARDING_KEY, "1");
    } catch {
      /* ignore */
    }
    onCompleted();
  }, [onCompleted]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="web-onboarding-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          background: "var(--background, #0c0c0c)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
        }}
      >
        {step === "directory" ? (
          <>
            <h2
              id="web-onboarding-title"
              style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600 }}
            >
              Escolha o Diretório
            </h2>
            <p style={{ margin: "0 0 24px", color: "var(--muted-foreground, #888)", fontSize: 14, lineHeight: 1.5 }}>
              Onde pretende guardar o seu vault? Na web, o vault em nuvem pode ser configurado nas definições. Para pasta
              local no disco, utilize a app Brain2 para macOS.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <OptionRow
                title="Local"
                subtitle="Pasta no seu computador — app Brain2 para macOS"
                onClick={() => {
                  window.alert(
                    "Para escolher uma pasta local no disco, instale a app Brain2 para macOS. Na web, pode usar vault na nuvem nas definições.",
                  );
                }}
              />
              <OptionRow
                title="Cloud"
                subtitle="Em breve — configure Google Drive nas definições quando disponível"
                onClick={() => window.alert("Em breve. Utilize as definições do Brain2 para integrações na nuvem.")}
              />
              <OptionRow
                title="Drive"
                subtitle="Em breve"
                onClick={() => window.alert("Em breve.")}
              />
            </div>
            <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={persistAndClose}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted-foreground, #888)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Continuar mais tarde
              </button>
              <button
                type="button"
                onClick={() => setStep("brain")}
                style={{
                  background: "var(--primary, #3b82f6)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Seguinte
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600 }}>Ative o seu cérebro</h2>
            <p style={{ margin: "0 0 20px", color: "var(--muted-foreground, #888)", fontSize: 14, lineHeight: 1.5 }}>
              Personalize a experiência com o seu nome (opcional). Pode alterar isto mais tarde.
            </p>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted-foreground, #888)", marginBottom: 8 }}>
              O seu nome
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="O seu nome"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.05)",
                color: "inherit",
                fontSize: 15,
                marginBottom: 24,
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setStep("directory")}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "inherit",
                  borderRadius: 8,
                  padding: "10px 16px",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={persistAndClose}
                style={{
                  background: "var(--primary, #3b82f6)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Continuar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OptionRow({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        textAlign: "left",
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.04)",
        color: "inherit",
        cursor: "pointer",
        width: "100%",
      }}
    >
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 15 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground, #888)", marginTop: 4 }}>
          {subtitle}
        </span>
      </span>
      <span style={{ opacity: 0.4 }}>›</span>
    </button>
  );
}

export function readWebDirectoryOnboardingCompleted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(WEB_DIRECTORY_ONBOARDING_KEY) === "1";
  } catch {
    return true;
  }
}
