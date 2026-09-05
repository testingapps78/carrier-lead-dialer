"use client";

import { useEffect, useState } from "react";
import { Megaphone, Send, Trash2 } from "lucide-react";
import { TeamPost } from "@/lib/types";

export default function TeamFeed({ isAdmin, userId }: { isAdmin: boolean; userId: string }) {
  const [posts, setPosts] = useState<TeamPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [asBroadcast, setAsBroadcast] = useState(false);
  const [sending, setSending] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/team-posts")
      .then((r) => r.json())
      .then((d) => setPosts(d.posts ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      await fetch("/api/team-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, isBroadcast: asBroadcast }),
      });
      setBody("");
      setAsBroadcast(false);
      load();
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this post?")) return;
    await fetch(`/api/team-posts?id=${id}`, { method: "DELETE" });
    setPosts((p) => p.filter((post) => post.id !== id));
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pt-5 pb-28">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Team feed</h1>

      <form onSubmit={send} className="bg-surface border border-border rounded-xl p-4 mb-5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isAdmin ? "Share an update or announcement…" : "Got a sale? Let the team know…"}
          rows={2}
          className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-ink focus:border-accent outline-none resize-none mb-3"
        />
        <div className="flex items-center justify-between">
          {isAdmin ? (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={asBroadcast} onChange={(e) => setAsBroadcast(e.target.checked)} />
              Post as team announcement
            </label>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="flex items-center gap-1.5 bg-accent text-base font-semibold rounded-lg px-3.5 py-2 text-sm disabled:opacity-50"
          >
            <Send size={13} /> Post
          </button>
        </div>
      </form>

      {loading && <div className="text-muted text-center py-12">Loading…</div>}

      {!loading && posts.length === 0 && (
        <div className="text-center text-muted py-16 border border-dashed border-border rounded-xl">
          No posts yet — share a win or an update with the team.
        </div>
      )}

      <div className="space-y-2">
        {posts.map((post) => (
          <div
            key={post.id}
            className={`rounded-xl px-4 py-3 border ${
              post.is_broadcast ? "bg-accent/10 border-accent/30" : "bg-surface border-border"
            }`}
          >
            <div className="flex items-start gap-2">
              {post.is_broadcast && <Megaphone size={14} className="text-accent mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted mb-1">
                  <span className="font-medium text-ink">{post.profiles?.full_name || "Someone"}</span>
                  <span>
                    {new Date(post.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{post.body}</p>
                {post.carriers?.legal_name && <p className="text-xs text-muted mt-1">Re: {post.carriers.legal_name}</p>}
              </div>
              {(post.author_id === userId || isAdmin) && (
                <button onClick={() => remove(post.id)} className="text-muted hover:text-bad transition-colors shrink-0">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
