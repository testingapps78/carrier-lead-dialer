"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeInitScript() {
  // Runs before paint so there's no flash of the wrong theme on load.
  const code = `(function(){try{var t=localStorage.getItem('cd_theme');if(t==='light'){document.documentElement.classList.add('light');}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export default function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !isLight;
    setIsLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("cd_theme", next ? "light" : "dark");
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      className="text-muted hover:text-ink transition-colors p-1.5 rounded-full hover:bg-surface2"
    >
      {isLight ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
