import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "block",
});

export const metadata: Metadata = {
  title: "Brain2 — The Extension of Your Mind",
  description: "Brain2 is your intelligent second brain.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className="h-full"
      data-theme="dark"
      style={{ touchAction: "manipulation", height: "100vh", width: "100vw" }}
      suppressHydrationWarning
    >
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                function applyTheme(theme) {
                  document.documentElement.setAttribute('data-theme', theme);
                  if (document.body) {
                    document.body.setAttribute('data-theme', theme);
                  }
                }

                try {
                  var savedTheme = localStorage.getItem('brain2-theme');
                  var nextTheme = savedTheme === 'light' ? 'light' : 'dark';
                  applyTheme(nextTheme);
                  document.addEventListener('DOMContentLoaded', function () {
                    applyTheme(nextTheme);
                  });
                } catch (_) {
                  applyTheme('dark');
                  document.addEventListener('DOMContentLoaded', function () {
                    applyTheme('dark');
                  });
                }
              })();
            `,
          }}
        />
        <noscript>
          <style>{`body { opacity: 1 !important; visibility: visible !important; }`}</style>
        </noscript>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.addEventListener('touchmove', function(e) {
                if (e.touches.length > 1) {
                  e.preventDefault();
                }
              }, false);
              document.addEventListener('gesturestart', function(e) {
                e.preventDefault();
              }, false);
            `,
          }}
        />
      </head>
      <body
        className={`${inter.className} h-full flex flex-col`}
        data-theme="dark"
        style={{ height: "100vh", width: "100vw", opacity: 0, visibility: "hidden" }}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
