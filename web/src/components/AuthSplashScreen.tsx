"use client";

/**
 * Mostrada enquanto o Firebase resolve o estado de sessão.
 * Evita o flash da tela de login para utilizadores já autenticados.
 */
export default function AuthSplashScreen() {
  return (
    <main className="auth-splash-root" role="status" aria-live="polite" aria-label="A iniciar Brain2">
      <div className="auth-splash-aura" aria-hidden />
      <div className="auth-splash-vignette" aria-hidden />
      <div className="auth-splash-content">
        <div className="auth-splash-title-wrap">
          <h1 className="auth-splash-title">Brain2</h1>
          <div className="auth-splash-shine" aria-hidden />
        </div>
        <p className="auth-splash-subtitle">The Extension of Your Mind</p>
      </div>

      <style jsx>{`
        .auth-splash-root {
          position: fixed;
          inset: 0;
          z-index: 100000;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--background);
          overflow: hidden;
        }

        .auth-splash-aura {
          position: absolute;
          width: 140%;
          height: 90%;
          left: 50%;
          top: 38%;
          transform: translate(-50%, -50%);
          background: radial-gradient(
            ellipse 55% 45% at 50% 45%,
            rgba(255, 255, 255, 0.065) 0%,
            rgba(255, 255, 255, 0.02) 42%,
            transparent 72%
          );
          animation: splashAuraDrift 14s ease-in-out infinite alternate;
          pointer-events: none;
        }

        .auth-splash-vignette {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            ellipse 80% 70% at 50% 50%,
            transparent 0%,
            rgba(0, 0, 0, 0.35) 100%
          );
          opacity: 0.55;
          pointer-events: none;
        }

        .auth-splash-content {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(14px, 2.5vw, 22px);
          text-align: center;
          padding: 24px;
          animation: splashContentRise 1.05s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .auth-splash-title-wrap {
          position: relative;
          display: inline-block;
        }

        .auth-splash-title {
          margin: 0;
          font-family: "Inter", system-ui, sans-serif;
          font-size: clamp(2.1rem, 6.5vw, 3.6rem);
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--hero-title);
          opacity: 0;
          transform: translateY(22px) scale(0.97);
          filter: blur(10px);
          animation: splashTitleReveal 1.15s cubic-bezier(0.16, 1, 0.3, 1) 0.05s forwards;
        }

        .auth-splash-subtitle {
          margin: 0;
          max-width: 22rem;
          font-family: "Inter", system-ui, sans-serif;
          font-size: clamp(0.62rem, 1.45vw, 0.8rem);
          font-weight: 300;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--hero-subtitle);
          opacity: 0;
          transform: translateY(16px);
          animation: splashSubtitleReveal 1s cubic-bezier(0.22, 1, 0.36, 1) 0.38s forwards;
        }

        .auth-splash-shine {
          position: absolute;
          bottom: -2px;
          left: 50%;
          width: min(200px, 48vw);
          height: 1px;
          transform: translateX(-50%);
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.12),
            transparent
          );
          opacity: 0;
          animation: splashShineIn 0.8s ease 0.9s forwards, splashShineSweep 3.2s ease-in-out 1.7s infinite;
        }

        @keyframes splashAuraDrift {
          0% {
            opacity: 0.75;
            transform: translate(-50%, -50%) scale(1) rotate(0deg);
          }
          100% {
            opacity: 1;
            transform: translate(-48%, -52%) scale(1.06) rotate(2deg);
          }
        }

        @keyframes splashContentRise {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes splashTitleReveal {
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes splashSubtitleReveal {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes splashShineIn {
          to {
            opacity: 1;
          }
        }

        @keyframes splashShineSweep {
          0%,
          100% {
            opacity: 0.35;
            transform: translateX(-50%) scaleX(0.85);
          }
          50% {
            opacity: 0.95;
            transform: translateX(-50%) scaleX(1.08);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .auth-splash-aura {
            animation: none;
            opacity: 0.85;
          }

          .auth-splash-content {
            animation: none;
            opacity: 1;
          }

          .auth-splash-title {
            animation: none;
            opacity: 1;
            transform: none;
            filter: none;
          }

          .auth-splash-subtitle {
            animation: none;
            opacity: 1;
            transform: none;
          }

          .auth-splash-shine {
            animation: none;
            opacity: 0.5;
          }
        }
      `}</style>
    </main>
  );
}
