"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Citation = { marker: number; itemId: string; title: string; entityType: string };
type Post = {
  id: string;
  theme: string;
  body: string;
  hashtags: string[];
  citationMarkers: number[];
  citations: Citation[];
  image?: string | null;
  createdAt: string;
};
type Rec = { id: string; theme: string; body: string; rating: number; feedback: string; createdAt: string };

// Author identity — a person who builds Sampleify, not the product itself.
const AUTHOR = { name: "Deepak Cybit", title: "Building Sampleify LIMS", initials: "DC" };

export function TrainingClient() {
  const [post, setPost] = useState<Post | null>(null);
  const [history, setHistory] = useState<Rec[]>([]);
  const [rating, setRating] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [learned, setLearned] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [autoExpand, setAutoExpand] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [svgLoading, setSvgLoading] = useState(false);
  const [artDirection, setArtDirection] = useState("");

  const avg = history.length ? (history.reduce((s, r) => s + r.rating, 0) / history.length).toFixed(1) : "—";
  const trend = history.length >= 4 ? avgOf(history.slice(-3)) - avgOf(history.slice(-6, -3)) : 0;

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLearned([]);
    try {
      const res = await fetch("/api/social/train", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ focus: focus.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Generation failed.");
        setPost(null);
      } else {
        setPost(data);
        setRating(0);
        setFeedback("");
        setImage(null);
        setSvg(null);
        setArtDirection("");
      }
    } finally {
      setLoading(false);
    }
  }, [focus]);

  const makeGraphic = useCallback(
    async (p: Post, direction?: string) => {
      setSvgLoading(true);
      try {
        const res = await fetch("/api/social/graphic", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ postId: p.id, body: p.body, theme: p.theme, direction }),
        });
        const data = await res.json();
        if (res.ok && data.png) {
          setImage(data.png);
          setSvg(data.svg ?? null);
        }
      } finally {
        setSvgLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/social/train");
        if (res.ok) {
          const state = await res.json();
          setHistory(state.history ?? []);
          if (state.pending) {
            setPost(state.pending);
            if (state.pending.image) setImage(state.pending.image);
          }
        }
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  // Auto-generate a graphic once a post is loaded without one.
  useEffect(() => {
    if (post && !image && !svgLoading) makeGraphic(post);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  const rateAndNext = useCallback(async () => {
    if (!post || rating === 0 || submitting || loading) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/social/train/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: post.id, theme: post.theme, body: post.body, rating, feedback }),
      });
      const data = await res.json();
      if (res.ok) {
        setHistory(data.history ?? []);
        setLearned(data.learnedRules ?? []);
      }
    } finally {
      setSubmitting(false);
    }
    await generate();
  }, [post, rating, feedback, submitting, loading, generate]);

  // Keyboard: 1-9 and 0(=10) set rating; Enter submits & advances (unless typing feedback).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!post) return;
      const target = e.target as HTMLElement;
      const typing = target.tagName === "TEXTAREA" || target.tagName === "INPUT";
      if (!typing && /^[0-9]$/.test(e.key)) {
        setRating(e.key === "0" ? 10 : Number(e.key));
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !typing)) {
        e.preventDefault();
        rateAndNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [post, rateAndNext]);

  async function resetAll() {
    await fetch("/api/social/train", { method: "DELETE" });
    setHistory([]);
    setPost(null);
    setLearned([]);
  }

  return (
    <div className="tr">
      {/* CENTER — just the feed, like linkedin.com/feed */}
      <main className="tr-feed">
        {!booted ? (
          <div className="placeholder">Loading…</div>
        ) : error ? (
          <div className="placeholder err">
            {error} {error.includes("ingest") && <Link href="/knowledge" className="chip">Ingest material</Link>}
          </div>
        ) : !post ? (
          <div className="start">
            <div className="start-title">Review posts, teach your taste</div>
            <p>One grounded post at a time. Score it, leave a note, and the next one is written on what you&apos;ve rated.</p>
            <button className="btn big" disabled={loading} onClick={generate}>
              {loading ? "Writing…" : history.length ? "Next post" : "Start"}
            </button>
          </div>
        ) : (
          <FeedCard post={post} autoExpand={autoExpand} image={image} svgLoading={svgLoading} />
        )}
      </main>

      {/* RIGHT — control panel: everything that isn't the post */}
      <aside className="tr-panel">
        <div className="panel-head">
          <h1>Training</h1>
          <div className="panel-metrics">
            <Metric label="rated" value={String(history.length)} />
            <Metric label="avg" value={avg} />
            {history.length >= 4 && (
              <Metric
                label="trend"
                value={`${trend >= 0 ? "▲" : "▼"}${Math.abs(trend).toFixed(1)}`}
                color={trend >= 0 ? "var(--ok)" : "var(--danger)"}
              />
            )}
          </div>
        </div>

        {/* View controls */}
        <div className="panel-card">
          <div className="panel-label">View</div>
          <label className="switch">
            <input type="checkbox" checked={autoExpand} onChange={(e) => setAutoExpand(e.target.checked)} />
            <span className="switch-track" />
            <span className="switch-text">Auto &ldquo;…more&rdquo; (expand fully)</span>
          </label>
          <div className="panel-sub">A dotted marker shows where LinkedIn cuts the post (~210 chars on desktop).</div>
        </div>

        {post && (
          <>
            {post.theme && (
              <div className="round-row">
                <span className="round-pill">Round {history.length + 1}</span>
                <span className="round-theme">{post.theme}</span>
              </div>
            )}

            <div className="panel-card rate">
              <div className="rail-q">Would you post this?</div>
              <div className="scale">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button key={n} className={`pip ${rating === n ? "sel" : rating >= n ? "on" : ""}`} onClick={() => setRating(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="scale-ends"><span>weak</span><span>would post</span></div>
              <textarea
                className="fb"
                rows={4}
                value={feedback}
                placeholder="Why? Be specific: 'hook is generic', 'cut the last line', 'love the concrete opener'. This becomes a rule."
                onChange={(e) => setFeedback(e.target.value)}
              />
              <button className="btn big full" disabled={rating === 0 || submitting || loading} onClick={rateAndNext}>
                {submitting || loading ? "Learning…" : "Rate & next"}
              </button>
              <div className="hint">press <kbd>1</kbd>–<kbd>0</kbd> to score, <kbd>Enter</kbd> to submit</div>
            </div>

            <div className="panel-card">
              <div className="panel-label">Graphic</div>
              <div className="gfx-actions">
                <input
                  className="gfx-dir"
                  value={artDirection}
                  placeholder='Art direction — "use a chart", "more minimal"'
                  onChange={(e) => setArtDirection(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && post) makeGraphic(post, artDirection.trim() || undefined); }}
                />
                <button
                  className="btn ghost small"
                  disabled={svgLoading}
                  onClick={() => post && makeGraphic(post, artDirection.trim() || undefined)}
                >
                  {svgLoading ? "Drawing…" : "Regenerate"}
                </button>
              </div>
              {(image || svg) && (
                <div className="gfx-dl">
                  {image && <button className="link-btn" onClick={() => downloadDataUrl(image, post.theme, "png")}>Download PNG</button>}
                  {svg && <button className="link-btn" onClick={() => downloadText(svg, post.theme, "svg")}>Download SVG</button>}
                </div>
              )}
            </div>

            {post.citations.length > 0 && (
              <div className="panel-card">
                <div className="panel-label">Grounded in</div>
                <div className="chips">
                  {post.citations.slice(0, 6).map((c) => (
                    <Link key={c.itemId} href={`/item/${c.itemId}`} target="_blank" className="chip">{c.title}</Link>
                  ))}
                </div>
              </div>
            )}

            {learned.length > 0 && (
              <div className="learned">
                <div className="learned-h">Learned from your last rating</div>
                {learned.map((r, i) => <div key={i} className="learned-r">{r}</div>)}
              </div>
            )}
          </>
        )}

        <button className="hist-toggle" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "Hide" : "Show"} rated history ({history.length})
        </button>
        {showHistory && (
          <div className="hist">
            {history.length === 0 ? (
              <p className="hist-empty">Nothing rated yet.</p>
            ) : (
              [...history].reverse().map((r) => (
                <div key={r.id} className="hist-item">
                  <span className={`hist-score ${r.rating >= 7 ? "good" : r.rating <= 4 ? "bad" : "mid"}`}>{r.rating}</span>
                  <div className="hist-text">
                    <div className="hist-theme">{r.theme}</div>
                    {r.feedback && <div className="hist-fb">&ldquo;{r.feedback}&rdquo;</div>}
                  </div>
                </div>
              ))
            )}
            {history.length > 0 && <button className="btn ghost small full" onClick={resetAll}>Reset training</button>}
          </div>
        )}
      </aside>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="metric">
      <span className="metric-v" style={color ? { color } : undefined}>{value}</span>
      <span className="metric-l">{label}</span>
    </div>
  );
}

function avgOf(rs: Rec[]) {
  return rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : 0;
}

function slug(s: string) {
  return (s || "post").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "post";
}

function downloadDataUrl(dataUrl: string, theme: string, ext: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${slug(theme)}.${ext}`;
  a.click();
}

function downloadText(content: string, theme: string, ext: string) {
  const blob = new Blob([content], { type: ext === "svg" ? "image/svg+xml" : "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(theme)}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// LinkedIn desktop feed truncates a post at ~210 characters before "…see more".
// (Verified across several 2026 sources; ~140 on mobile, ~210 on desktop.)
const FOLD = 210;

function FeedCard({ post, autoExpand, image, svgLoading }: { post: Post; autoExpand: boolean; image: string | null; svgLoading: boolean }) {
  const tags = post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const full = tags ? `${post.body}\n\n${tags}` : post.body;
  const [manualExpanded, setManualExpanded] = useState(false);
  const expanded = autoExpand || manualExpanded;
  const overFold = full.length > FOLD;

  // Reset manual expansion when the post changes.
  useEffect(() => setManualExpanded(false), [post.id]);

  let bodyNode: ReactNode;
  if (!overFold) {
    bodyNode = full;
  } else if (!expanded) {
    bodyNode = (
      <>
        {full.slice(0, FOLD).trimEnd()}
        <span className="more-wrap"> …<button className="more" onClick={() => setManualExpanded(true)}>more</button></span>
      </>
    );
  } else {
    // Fully expanded, with a dotted marker at the natural fold point.
    bodyNode = (
      <>
        {full.slice(0, FOLD)}
        <span className="fold-marker" title={`LinkedIn cuts here (~${FOLD} chars)`} />
        {full.slice(FOLD)}
      </>
    );
  }

  return (
    <div className="feed">
      <div className="feed-top">
        <div className="avatar">{AUTHOR.initials}</div>
        <div className="who">
          <div className="who-name">{AUTHOR.name} <span className="deg">· 1st</span></div>
          <div className="who-title">{AUTHOR.title}</div>
          <div className="who-time">2h · 🌐</div>
        </div>
        <button className="follow">＋ Follow</button>
      </div>
      <div className="feed-body">{bodyNode}</div>
      <div className="feed-image">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="feed-svg" src={image} alt="Post graphic" />
        ) : (
          <div className="feed-svg skeleton">{svgLoading ? "Designing graphic…" : "No graphic"}</div>
        )}
      </div>
      <div className="feed-stats">
        <span className="feed-react"><span className="emojis">👍❤️💡</span> 42</span>
        <span>7 comments · 3 reposts</span>
      </div>
      <div className="feed-actions">
        <span>👍 Like</span><span>💬 Comment</span><span>🔁 Repost</span><span>➤ Send</span>
      </div>
    </div>
  );
}

