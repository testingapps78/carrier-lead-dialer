import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeInitScript } from "@/components/ThemeToggle";
import ActivityTracker from "@/components/ActivityTracker";

// Inter, self-hosted through next/font (same files the app already ships; nothing is fetched at build time).
const inter = localFont({
  src: [
    { path: "../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

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
    // suppressHydrationWarning: the inline theme script sets data-theme before React hydrates
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body className="font-body bg-canvas text-ink min-h-screen antialiased">
        <ActivityTracker />
        {children}
      </body>
    </html>
  );
}
