import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brain2 — The Extension of Your Mind",
  description: "Brain2 is your intelligent second brain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full flex flex-col">{children}</body>
    </html>
  );
}
