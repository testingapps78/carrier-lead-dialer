import type { Metadata } from "next";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/oswald/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import { ThemeInitScript } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Carrier Dialer",
  description: "FMCSA carrier lookup and lead tracking for cold calling.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <ThemeInitScript />
      </head>
      <body className="font-body bg-canvas text-ink min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
