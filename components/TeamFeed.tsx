"use client";

import Tile from "@/components/Tile";
import { useEffect, useState } from "react";
import { Megaphone, Send, Trash2 } from "lucide-react";
import { TeamPost } from "@/lib/types";

interface OnlineMember {
  id: string;
  name: string;
  online: boolean;
}

export default function TeamFeed({ isAdmin, userId }: { isAdmin: boolean; userId: string }) {
  const [posts, setPosts] = useState<TeamPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [asBroadcast, setAsBroadcast] = useState(false);
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<OnlineMember[]>([]);

  function load() {
    setLoading(true);
    fetch("/api/team-posts")
      .then((r) => r.json())
      .then((d) => setPosts(d.posts ?? []))
      .finally(() => setLoading(false));
  }

  function loadPresence() {
    fetch("/api/team/online")
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []))
      .catch(() => {});
  }

  useEffect(load, []);
  useEffect(() => {
    loadPresence();
    const id = setInterval(loadPresence, 30000);
    return () => clearInterval(id);
  }, []);

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
    <div className="w-full px-6 pt-4 pb-24 md:pb-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Team feed</h1>

      <div className="grid gap-4 xl:grid-cols-12 items-start">
        <div className="grid gap-4 xl:col-span-8">
          <Tile label={isAdmin ? "Share an update or announcement" : "Share a win"}>
            <form onSubmit={send}>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={isAdmin ? "Share an update or announcement…" : "Got a sale? Let the team know…"}
                rows={2}
                className="w-full bg-inset border border-border rounded-xl px-3 py-2 text-sm text-ink focus:border-accent outline-none resize-none mb-3"
              />
              <div className="flex items-center justify-between gap-3">
                {isAdmin ? (
                  <label className="flex items-center gap-2 text-sm text-muted min-h-[40px]">
                    <input type="checkbox" checked={asBroadcast} onChange={(e) => setAsBroadcast(e.target.checked)} />
                    Post as team announcement
                  </label>
                ) : (
                  <span />
                )}
                <button type="submit" disabled={sending || !body.trim()} className="btn btn-primary disabled:opacity-50">
                  <Send size={14} /> Post
                </button>
              </div>
            </form>
          </Tile>

          <Tile label="Feed">
            {loading && <div className="text-muted text-center py-12">Loading…</div>}

            {!loading && posts.length === 0 && (
              <div className="text-center text-muted py-16 border border-dashed border-border rounded-tile">
                No posts yet — share a win or an update with the team.
              </div>
            )}

            <div className="space-y-3">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className={`rounded-2xl px-4 py-3 border ${
                    post.is_broadcast ? "bg-accent/10 border-accent/40" : "bg-inset border-border"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {post.is_broadcast && <Megaphone size={16} className="text-accent-ink mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-muted mb-1">
                        <span className="font-semibold text-ink">{post.profiles?.full_name || "Someone"}</span>
                        <span className="num">
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
                      <button
                        onClick={() => remove(post.id)}
                        aria-label="Delete post"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:text-bad hover:bg-bad/10 transition-colors shrink-0"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Tile>
        </div>

        <Tile label="Team" className="xl:col-span-4">
          {members.length === 0 ? (
            <div className="text-muted text-sm">No teammates to show yet.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {members.map((m) => (
                <div key={m.id} className="rounded-2xl border border-border bg-inset px-3 py-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${m.online ? "bg-good" : "bg-muted"}`} />
                    <span className="text-sm font-semibold truncate">{m.name}</span>
                  </div>
                  <div className={`text-xs mt-1 ${m.online ? "text-good" : "text-muted"}`}>{m.online ? "Online" : "Offline"}</div>
                </div>
              ))}
            </div>
          )}
        </Tile>
      </div>
    </div>
  );
}
