"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

const KEY = "cd_view_more";

/** Collapsible "View more" section. Remembers open/closed while the tab stays open. */
export default function ViewMore({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(sessionStorage.getItem(KEY) === "1");
    } catch {
      /* storage can be unavailable */
    }
  }, []);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try {
        sessionStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <div className="tile !py-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 text-sm font-medium text-accent-ink hover:opacity-80 min-h-[40px]"
        aria-expanded={open}
      >
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Show less" : "View more details"}
      </button>
      {open && <div className="mt-1 mb-2 space-y-3">{children}</div>}
    </div>
  );
}
