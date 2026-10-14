"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({ value, label, tone = "default" }: { value: string; label?: string; tone?: "default" | "onAccent" }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — silently no-op rather than throw in the UI.
    }
  }

  return (
    <button
      onClick={copy}
      type="button"
      className={`text-xs px-2.5 min-h-[28px] rounded-lg border transition-colors ${
        tone === "onAccent"
          ? "border-accent-text/40 text-accent-text hover:bg-accent-text/10"
          : "border-border text-muted hover:text-ink hover:border-accent"
      }`}
    >
      {label === "" ? (
        <span className="inline-flex items-center justify-center" aria-label={copied ? "Copied" : "Copy"}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </span>
      ) : copied ? (
        "Copied"
      ) : (
        label ?? "Copy"
      )}
    </button>
  );
}
