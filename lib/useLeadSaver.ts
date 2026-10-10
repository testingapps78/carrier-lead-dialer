"use client";

import { useEffect, useMemo, useState } from "react";
import { LeadNotesSaver, clearAllStoredDrafts, type SaveResult } from "@/lib/leadSaver";
import { post } from "@/lib/leadClient";

// All live savers in this tab, so logout / page-leave code can flush every unsaved note.
const savers = new Set<LeadNotesSaver>();

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function hasUnsavedDrafts(): boolean {
  return Array.from(savers).some((s) => s.hasPending());
}

export async function flushAllDrafts(): Promise<{ ok: boolean; failed: number }> {
  const results = await Promise.all(Array.from(savers).map((s) => s.flushAll()));
  const failed = results.reduce((n, r) => n + r.failed.length, 0);
  return { ok: failed === 0, failed };
}

/** Removes every locally stored unsaved draft. Called at logout. */
export function clearStoredDraftsForLogout() {
  clearAllStoredDrafts(safeStorage());
}

export function useLeadSaver(userId: string, onLead: (dot: number, lead: any) => void): LeadNotesSaver {
  const [, force] = useState(0);
  const saver = useMemo(
    () =>
      new LeadNotesSaver({
        userId,
        storage: safeStorage(),
        onChange: () => force((n) => n + 1),
        save: async ({ dot, notes, expectedUserId }): Promise<SaveResult> => {
          const r = await post("/api/leads", { dot_number: dot, notes, expected_user_id: expectedUserId });
          if (r.ok) return { ok: true, lead: r.data.lead };
          return { ok: false, error: r.error, fatal: r.code === "account_changed" || r.code === "not_signed_in" };
        },
      }),
    [userId]
  );

  useEffect(() => {
    saver.setOnLead(onLead);
  }, [saver, onLead]);

  useEffect(() => {
    savers.add(saver);
    // Best-effort warning if the tab is closed with unconfirmed notes. It is NOT the safety net:
    // drafts are also kept in local storage and saved on navigation, retry, and logout.
    const warn = (e: BeforeUnloadEvent) => {
      if (saver.hasPending()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      savers.delete(saver);
      saver.destroy();
    };
  }, [saver]);

  return saver;
}
