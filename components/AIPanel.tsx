"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, ThumbsUp, ThumbsDown, Settings2, Mail, Check } from "lucide-react";
import type { Carrier, CallStatus } from "@/lib/types";
import CopyButton from "@/components/CopyButton";
import { spokenSeconds, wordCount } from "@/lib/callBrief";

type Task = "coach" | "notes" | "followup";

interface Settings {
  display_name: string;
  company_name: string;
  offer: string;
  style_notes: string;
}

const TASK_LABEL: Record<Task, string> = {
  coach: "Coach me",
  notes: "Clean up notes",
  followup: "Draft follow-up",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide text-muted mb-1">{children}</div>;
}

export default function AIPanel({
  carrier,
  notes,
  statuses,
  onApplyNotes,
  onApplyStatus,
}: {
  carrier: Carrier;
  notes: string;
  statuses: CallStatus[];
  onApplyNotes: (text: string) => void;
  onApplyStatus: (value: string) => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState<Task | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  // A new carrier means any old answer no longer applies.
  useEffect(() => {
    setTask(null);
    setResult(null);
    setError(null);
    setRating(null);
    setComment("");
    setFeedbackSent(false);
  }, [carrier.dot_number]);

  useEffect(() => {
    fetch("/api/ai/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) setSettings(d.settings);
        setConfigured(!!d.configured);
      })
      .catch(() => {});
  }, []);

  async function run(next: Task) {
    setTask(next);
    setLoading(next);
    setResult(null);
    setError(null);
    setRating(null);
    setComment("");
    setFeedbackSent(false);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: next, dot_number: carrier.dot_number, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "AI request failed.");
      setResult(data.result);
    } catch (e: any) {
      setError(e?.message || "AI request failed.");
    } finally {
      setLoading(null);
    }
  }

  async function sendFeedback() {
    if (!task || rating === null || !result) return;
    try {
      await fetch("/api/ai/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          dot_number: carrier.dot_number,
          rating,
          comment,
          output: JSON.stringify(result),
        }),
      });
    } catch {
      // feedback is best-effort
    }
    setFeedbackSent(true);
  }

  async function saveSettings() {
    if (!settings) return;
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Couldn't save.");
      setSettingsMsg("Saved. New answers will use this.");
    } catch (e: any) {
      setSettingsMsg(e?.message || "Couldn't save.");
    } finally {
      setSavingSettings(false);
    }
  }

  const statusLabel = (value: string | null) => statuses.find((s) => s.value === value)?.label ?? value;

  function notesText(r: any): string {
    const facts = (r.key_facts ?? []).map((f: string) => `• ${f}`).join("\n");
    return [r.summary, facts, r.next_step ? `Next: ${r.next_step}` : ""].filter(Boolean).join("\n");
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-accent">
          <Sparkles size={12} /> AI helper
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <Settings2 size={12} /> My pitch
        </button>
      </div>

      {showSettings && settings && (
        <div className="mb-4 space-y-2 text-sm">
          <p className="text-xs text-muted">The AI uses this in every script and message. Add your fee and what you do for carriers.</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={settings.display_name}
              onChange={(e) => setSettings({ ...settings, display_name: e.target.value })}
              placeholder="Your first name"
              className="bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-accent"
            />
            <input
              value={settings.company_name}
              onChange={(e) => setSettings({ ...settings, company_name: e.target.value })}
              placeholder="Company name"
              className="bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <textarea
            value={settings.offer}
            onChange={(e) => setSettings({ ...settings, offer: e.target.value })}
            placeholder="What you offer, e.g. dispatch for 6% of gross: find loads, negotiate rates, handle paperwork"
            rows={3}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-accent resize-none"
          />
          <textarea
            value={settings.style_notes}
            onChange={(e) => setSettings({ ...settings, style_notes: e.target.value })}
            placeholder="Style rules, e.g. short and direct, no jargon"
            rows={2}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-accent resize-none"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={saveSettings}
              disabled={savingSettings}
              className="text-sm px-3 py-2 rounded-lg bg-accent text-oncolor font-medium disabled:opacity-60"
            >
              {savingSettings ? "Saving…" : "Save"}
            </button>
            {settingsMsg && <span className="text-xs text-muted">{settingsMsg}</span>}
          </div>
        </div>
      )}

      {configured === false && (
        <p className="text-xs text-muted mb-3">AI isn&apos;t switched on yet. It needs a free API key added in Vercel.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TASK_LABEL) as Task[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => run(t)}
            disabled={loading !== null}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors min-h-[32px] disabled:opacity-60 ${
              task === t ? "border-accent text-accent bg-accent/10" : "border-border text-ink hover:border-accent"
            }`}
          >
            {loading === t ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Thinking…
              </span>
            ) : (
              TASK_LABEL[t]
            )}
          </button>
        ))}
      </div>

      {error && <div className="mt-2 text-sm text-bad">{error}</div>}

      <div className="lg:max-h-[34vh] lg:overflow-y-auto pr-1">

      {result && task === "coach" && (
        <div className="mt-4 space-y-4 text-sm">
          <div>
            <SectionLabel>Opener</SectionLabel>
            <div className="flex items-start gap-2">
              <p className="text-base leading-snug flex-1">&ldquo;{result.opener}&rdquo;</p>
              <CopyButton value={result.opener} />
            </div>
            <div className="text-xs text-muted mt-1">
              {wordCount(result.opener)} words, about {spokenSeconds(result.opener)}s spoken
            </div>
          </div>
          {result.talking_points?.length > 0 && (
            <div>
              <SectionLabel>Talking points</SectionLabel>
              <ul className="space-y-1 list-disc pl-4">
                {result.talking_points.map((p: string, i: number) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {result.objections?.length > 0 && (
            <div>
              <SectionLabel>If they say…</SectionLabel>
              <div className="space-y-2">
                {result.objections.map((o: { objection: string; reply: string }, i: number) => (
                  <div key={i}>
                    <div className="font-medium">&ldquo;{o.objection}&rdquo;</div>
                    <div className="text-muted">{o.reply}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.discovery_question && (
            <div>
              <SectionLabel>Ask</SectionLabel>
              <p>{result.discovery_question}</p>
            </div>
          )}
        </div>
      )}

      {result && task === "notes" && (
        <div className="mt-4 space-y-3 text-sm">
          <div>
            <SectionLabel>Summary</SectionLabel>
            <p>{result.summary}</p>
          </div>
          {result.key_facts?.length > 0 && (
            <ul className="space-y-1 list-disc pl-4">
              {result.key_facts.map((f: string, i: number) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          {result.next_step && (
            <div>
              <SectionLabel>Next step</SectionLabel>
              <p>{result.next_step}</p>
            </div>
          )}
          {result.callback_hint && <p className="text-muted">Call-back time mentioned: {result.callback_hint}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => onApplyNotes(notesText(result))}
              className="text-sm px-3 py-2 rounded-lg border border-accent/50 text-accent hover:bg-accent/10"
            >
              Replace my notes with this
            </button>
            {result.suggested_status && (
              <button
                type="button"
                onClick={() => onApplyStatus(result.suggested_status)}
                className="text-sm px-3 py-2 rounded-lg border border-border hover:border-accent"
              >
                Set status: {statusLabel(result.suggested_status)}
              </button>
            )}
          </div>
        </div>
      )}

      {result && task === "followup" && (
        <div className="mt-4 space-y-4 text-sm">
          <div>
            <SectionLabel>Email</SectionLabel>
            <div className="font-medium">{result.email?.subject}</div>
            <p className="whitespace-pre-wrap mt-1">{result.email?.body}</p>
            <div className="flex items-center gap-2 mt-2">
              <CopyButton value={`${result.email?.subject ?? ""}\n\n${result.email?.body ?? ""}`} />
              {carrier.email && (
                <a
                  href={`mailto:${carrier.email}?subject=${encodeURIComponent(result.email?.subject ?? "")}&body=${encodeURIComponent(result.email?.body ?? "")}`}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted hover:text-ink"
                >
                  <Mail size={12} /> Open in email app
                </a>
              )}
            </div>
          </div>
          <div>
            <SectionLabel>Text message</SectionLabel>
            <p>{result.sms}</p>
            <div className="flex items-center gap-2 mt-2">
              <CopyButton value={result.sms ?? ""} />
              <span className="text-xs text-muted">{(result.sms ?? "").length} characters</span>
            </div>
            <p className="text-xs text-muted mt-1">Only text people you&apos;ve already spoken with.</p>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4 pt-3 border-t border-border/60">
          {feedbackSent ? (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Check size={12} /> Thanks, this will shape future answers.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted">
                Was this useful?
                <button
                  type="button"
                  onClick={() => setRating(1)}
                  className={`p-2 rounded-lg border ${rating === 1 ? "border-accent text-accent" : "border-border"}`}
                  aria-label="Useful"
                >
                  <ThumbsUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setRating(-1)}
                  className={`p-2 rounded-lg border ${rating === -1 ? "border-bad text-bad" : "border-border"}`}
                  aria-label="Not useful"
                >
                  <ThumbsDown size={14} />
                </button>
              </div>
              {rating !== null && (
                <div className="flex gap-2">
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Optional: what should change?"
                    className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={sendFeedback}
                    className="text-sm px-3 py-2 rounded-lg bg-accent text-oncolor font-medium"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
