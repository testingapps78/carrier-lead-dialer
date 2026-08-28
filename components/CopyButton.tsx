"use client";

import { useState } from "react";

export default function CopyButton({ value, label }: { value: string; label?: string }) {
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
      className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-ink hover:border-accent transition-colors"
    >
      {copied ? "Copied" : label ?? "Copy"}
    </button>
  );
}
