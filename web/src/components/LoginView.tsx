"use client";

import { useState, type FormEvent } from "react";

type LoginViewProps = {
  onLogin: () => Promise<void> | void;
  authLoading?: boolean;
  authError?: string | null;
};

export default function LoginView({ onLogin, authLoading = false, authError = null }: LoginViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authLoading) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onLogin();
    } catch {
      // Errors are surfaced by the parent auth state.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (authLoading) {
      return;
    }

    setIsGoogleSubmitting(true);
    try {
      await onLogin();
    } catch {
      // Errors are surfaced by the parent auth state.
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const isBusy = isSubmitting || isGoogleSubmitting || authLoading;

  return (
    <main className="login-root" aria-label="Tela de login">
      <section className="login-card" role="form" aria-label="Acesso ao Brain2">
        <h1>Brain2</h1>
        <p>Entre para acessar seu segundo cerebro.</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@exemplo.com"
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Sua senha"
            />
          </label>

          <button
            className="google-btn"
            type="button"
            onClick={() => {
              void handleGoogleLogin();
            }}
            disabled={isBusy}
            aria-label="Entrar com Google"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              <path
                fill="#4285F4"
                d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.908c1.701-1.566 2.685-3.874 2.685-6.614Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.467-.806 5.956-2.181l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18Z"
              />
              <path
                fill="#FBBC05"
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.322 0 2.51.455 3.444 1.347l2.583-2.583C13.463.89 11.426 0 9 0A9 9 0 0 0 .957 4.958L3.964 7.29C4.672 5.164 6.656 3.58 9 3.58Z"
              />
            </svg>
            <span>{isBusy ? "Conectando..." : "Entrar com Google"}</span>
          </button>

          <button type="submit" disabled={isBusy}>
            {isBusy ? "Entrando..." : "Entrar"}
          </button>

          {authError && <p className="login-auth-error">{authError}</p>}
        </form>
      </section>

      <style jsx>{`
        .login-root {
          width: 100vw;
          height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background:
            radial-gradient(circle at 20% 10%, rgba(78, 168, 222, 0.12), transparent 35%),
            radial-gradient(circle at 80% 90%, rgba(124, 110, 240, 0.1), transparent 40%),
            var(--background);
        }

        .login-card {
          width: min(420px, 100%);
          border: 1px solid var(--bar-border);
          border-radius: 16px;
          background: rgba(18, 18, 18, 0.92);
          backdrop-filter: blur(8px);
          padding: 24px;
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
        }

        h1 {
          margin: 0;
          font-family: "Inter", sans-serif;
          font-size: 1.5rem;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #d7d7d7;
        }

        p {
          margin: 8px 0 0;
          font-family: "Inter", sans-serif;
          font-size: 0.78rem;
          color: #888;
          letter-spacing: 0.02em;
        }

        .login-form {
          margin-top: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field > span {
          font-family: "Inter", sans-serif;
          font-size: 0.72rem;
          color: #8a8a8a;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        input {
          height: 38px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          padding: 0 12px;
          background: rgba(255, 255, 255, 0.02);
          color: #e0e0e0;
          font-family: "Inter", sans-serif;
          font-size: 0.86rem;
          -webkit-text-fill-color: #e0e0e0;
          caret-color: #e0e0e0;
        }

        input::placeholder {
          color: rgba(224, 224, 224, 0.18);
        }

        input:focus {
          outline: none;
          border-color: rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.035);
        }

        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-text-fill-color: #e0e0e0;
          box-shadow: 0 0 0px 1000px rgba(255, 255, 255, 0.02) inset;
          -webkit-box-shadow: 0 0 0px 1000px rgba(255, 255, 255, 0.02) inset;
          transition: background-color 9999s ease-in-out 0s;
        }

        button {
          margin-top: 4px;
          height: 40px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
          color: #f0f0f0;
          font-family: "Inter", sans-serif;
          font-size: 0.86rem;
          font-weight: 500;
          letter-spacing: 0.03em;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.09);
          border-color: var(--bar-border-hover);
        }

        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .google-btn {
          margin-top: 2px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid var(--bar-border);
          background: rgba(255, 255, 255, 0.02);
          color: #dcdcdc;
        }

        .google-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.06);
          border-color: var(--bar-border-hover);
        }

        .google-btn svg {
          flex-shrink: 0;
        }

        .login-auth-error {
          margin: 4px 0 0;
          font-family: "Inter", sans-serif;
          font-size: 11px;
          line-height: 1.45;
          color: #cf8080;
        }
      `}</style>
    </main>
  );
}
