"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Tells the server when a person is actually using the app (tapping, typing,
// scrolling), so reading a carrier card or being mid-call doesn't look "idle".
// Sends at most one tiny ping every couple of minutes, and only if there was
// real interaction since the last one. Background polling never counts.
const PING_EVERY_MS = 2 * 60 * 1000;

export default function ActivityTracker() {
  const pathname = usePathname();
  const skip = pathname.startsWith("/login") || pathname.startsWith("/trial");

  useEffect(() => {
    if (skip) return;
    let lastPing = 0;

    function onInteraction() {
      const now = Date.now();
      if (now - lastPing < PING_EVERY_MS) return;
      lastPing = now;
      fetch("/api/activity", { method: "POST", keepalive: true }).catch(() => {});
    }

    const events = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, onInteraction, { passive: true, capture: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onInteraction, { capture: true }));
  }, [skip]);

  return null;
}
