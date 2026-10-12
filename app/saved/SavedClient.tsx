"use client";

/**
 * Saved posts — the user's curated gold standard.
 *
 * Posts the user saved from Training (and later the calendar) live here. They
 * are verified exemplars: injected into every future generation as the
 * strongest "write like this" signal. The user can read, annotate (why it's a
 * standard), copy, and remove them.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SavedPost = {
  id: string;
  body: string;
  theme: string;
  hashtags: string[];
  note: string;
  source: "training" | "calendar" | "manual";
  createdAt: string;
};
type SavedPosts = { workspaceId: string; posts: SavedPost[]; updatedAt: string };

const AUTHOR = { name: "Deepak Cybit", title: "Building Sampleify LIMS", initials: "DC" };

export function SavedClient() {
  const router = useRouter();
  const [sp, setSp] = useState<SavedPosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/social/saved");
      if (res.ok) setSp(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveNote = useCallback(
    async (post: SavedPost) => {
      const next = noteDraft[post.id];
      if (next === undefined || next === post.note) return;
      setBusy(post.id);
      try {
        const res = await fetch("/api/social/saved", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: post.id, note: next }),
        });
        if (res.ok) setSp(await res.json());
      } finally {
        setBusy(null);
      }
    },
    [noteDraft],
  );

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/social/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) setSp(await res.json());
    } finally {
      setBusy(null);
    }
  }, []);

  const copy = useCallback(async (post: SavedPost) => {
    const text = post.hashtags.length
      ? `${post.body}\n\n${post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`
      : post.body;
    await navigator.clipboard.writeText(text);
    setFlash("Copied to clipboard.");
    setTimeout(() => setFlash(null), 1800);
  }, []);

  const openInPlayground = useCallback(
    async (post: SavedPost) => {
      setBusy(post.id);
      try {
        const res = await fetch("/api/social/train/open", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ savedId: post.id }),
        });
        if (res.ok) router.push("/playground");
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  return (
    <div className="saved">
      <div className="saved-head">
        <h1>Saved</h1>
        <p className="lead">
          Your gold standard. Posts you save in the Playground become verified exemplars, the Studio writes future posts to match these more than anything else. Open any one to keep refining it.
        </p>
      </div>

      {flash && <div className="saved-flash">{flash}</div>}

      {loading ? (
        <div className="saved-empty">Loading…</div>
      ) : !sp || sp.posts.length === 0 ? (
        <div className="saved-empty">
          Nothing saved yet. In the <strong>Playground</strong>, hit <strong>Save post</strong> and it shows up here with its full history, ready to reopen and refine, and it shapes every post the Studio writes next.
        </div>
      ) : (
        <div className="saved-grid">
          {sp.posts.map((post) => (
            <div key={post.id} className="saved-card">
              <div className="saved-card-head">
                <div className="li-avatar">{AUTHOR.initials}</div>
                <div className="saved-author">
                  <div className="saved-name">{AUTHOR.name}</div>
                  <div className="saved-title">{AUTHOR.title}</div>
                </div>
                <span className={`saved-src saved-src-${post.source}`}>{post.source}</span>
              </div>

              {post.theme && <div className="saved-theme">{post.theme}</div>}
              <div className="saved-body">{post.body}</div>
              {post.hashtags.length > 0 && (
                <div className="saved-tags">{post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</div>
              )}

              <textarea
                className="saved-note"
                rows={2}
                placeholder="Why is this a standard? (optional note the Studio will read)"
                value={noteDraft[post.id] ?? post.note}
                disabled={busy === post.id}
                onChange={(e) => setNoteDraft((d) => ({ ...d, [post.id]: e.target.value }))}
                onBlur={() => saveNote(post)}
              />

              <div className="saved-actions">
                <button className="btn small" disabled={busy === post.id} onClick={() => openInPlayground(post)}>
                  Open in Playground
                </button>
                <button className="btn ghost small" onClick={() => copy(post)}>Copy</button>
                <button className="btn ghost small danger" disabled={busy === post.id} onClick={() => remove(post.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
