"use client";

import { useEffect } from "react";
import { Sun, Moon } from "lucide-react";

const KEY = "cd_theme"; // same storage key as before, so a saved choice keeps working

export function ThemeInitScript() {
  // Runs before first paint: saved choice wins, otherwise follow the system setting. No flash.
  const code = `(function(){try{var d=document.documentElement,s=localStorage.getItem('${KEY}');var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');d.setAttribute('data-theme',t);d.style.colorScheme=t;}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

function applyTheme(t: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t;
}

export default function ThemeToggle() {
  // While nothing is saved, follow the system setting if it changes.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(KEY)) return;
      } catch {
        /* storage blocked: keep following the system */
      }
      applyTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* the choice still applies for this visit */
    }
  }

  // Both icons are always rendered; CSS shows the right one for the active theme, so nothing flickers or mismatches on hydration.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light and dark theme"
      title="Toggle light and dark theme"
      className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:text-ink hover:bg-inset transition-colors"
    >
      <Sun size={18} className="hidden [[data-theme=dark]_&]:block" />
      <Moon size={18} className="block [[data-theme=dark]_&]:hidden" />
    </button>
  );
}
