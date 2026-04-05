import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="pt-BR" className="h-full" style={{ touchAction: "manipulation", height: "100vh", width: "100vw" }}>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
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
      <body className="h-full flex flex-col" style={{ height: "100vh", width: "100vw" }}>{children}</body>
    </html>
  );
}
