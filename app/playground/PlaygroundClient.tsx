"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Citation = { marker: number; itemId: string; title: string; entityType: string };
type CorrectionCategory = "product" | "world" | "audience" | "style";
type CorrectionProposal = {
  category: CorrectionCategory;
  statement: string;
  avoid: string;
  summary: string;
  destinationLabel: string;
};
type Turn = {
  id: string;
  role: "user" | "assistant";
  channel: "topic" | "body" | "media";
  text: string;
  body?: string;
  prevBody?: string;
  image?: string | null;
  createdAt: string;
};
type Post = {
  id: string;
  topic: string;
  theme: string;
  body: string;
  hashtags: string[];
  citationMarkers: number[];
  citations: Citation[];
  image?: string | null;
  correctionProposal?: CorrectionProposal | null;
  createdAt: string;
};

const AUTHOR = { name: "Deepak Cybit", title: "Building Sampleify LIMS", initials: "DC" };

export function PlaygroundClient() {
  const [post, setPost] = useState<Post | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [topic, setTopic] = useState("");
  const [postTopic, setPostTopic] = useState("");
  const [bodyNote, setBodyNote] = useState("");
  const [artDirection, setArtDirection] = useState("");
  const [loading, setLoading] = useState(false);
  const [redoKind, setRedoKind] = useState<null | "new" | "body">(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [correction, setCorrection] = useState<CorrectionProposal | null>(null);
  const [corrStatement, setCorrStatement] = useState("");
  const [corrAvoid, setCorrAvoid] = useState("");
  const [corrState, setCorrState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [svgLoading, setSvgLoading] = useState(false);

  const topicDirty = topic.trim() !== postTopic.trim();
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, loading]);

  const refreshTurns = useCallback(async () => {
    const res = await fetch("/api/social/train");
    if (res.ok) {
      const state = await res.json();
      setTurns(state.turns ?? []);
      if (state.pending) {
        setPost(state.pending);
        setImage(state.pending.image ?? null);
      }
    }
  }, []);

  const generate = useCallback(
    async (opts?: { keepTopic?: boolean; auto?: boolean; note?: string }) => {
      const keepTopic = !!opts?.keepTopic;
      const sendTopic = keepTopic || opts?.auto ? undefined : topic.trim() || undefined;
      setRedoKind(keepTopic ? "body" : "new");
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/social/train", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic: sendTopic, keepTopic, note: opts?.note?.trim() || undefined }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Generation failed.");
          if (!keepTopic) setPost(null);
          return;
        }
        setPost(data);
        setTopic(data.topic ?? "");
        setPostTopic(data.topic ?? "");
        setSaved(false);
        if (data.correctionProposal && (data.correctionProposal.statement || data.correctionProposal.avoid)) {
          setCorrection(data.correctionProposal);
          setCorrStatement(data.correctionProposal.statement ?? "");
          setCorrAvoid(data.correctionProposal.avoid ?? "");
          setCorrState("idle");
        } else {
          setCorrection(null);
        }
        if (keepTopic) {
          if (data.image) setImage(data.image);
        } else {
          setImage(null);
          setSvg(null);
          setArtDirection("");
        }
        await refreshTurns();
      } finally {
        setLoading(false);
        setRedoKind(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topic, refreshTurns],
  );

  const makeGraphic = useCallback(
    async (p: Post, direction?: string, record = true) => {
      setSvgLoading(true);
      try {
        const res = await fetch("/api/social/graphic", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ postId: p.id, body: p.body, theme: p.theme, direction, record }),
        });
        const data = await res.json();
        if (res.ok && data.png) {
          setImage(data.png);
          setSvg(data.svg ?? null);
          if (record) await refreshTurns();
        }
      } finally {
        setSvgLoading(false);
      }
    },
    [refreshTurns],
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/social/train");
        if (res.ok) {
          const state = await res.json();
          if (state.pending) {
            setPost(state.pending);
            setTurns(state.turns ?? []);
            setTopic(state.pending.topic ?? "");
            setPostTopic(state.pending.topic ?? "");
            if (state.pending.image) setImage(state.pending.image);
            try {
              const sres = await fetch("/api/social/saved");
              if (sres.ok) {
                const sp = await sres.json();
                const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
                const body = norm(state.pending.body ?? "");
                setSaved((sp.posts ?? []).some((p: { body: string }) => norm(p.body) === body));
              }
            } catch {
              /* non-fatal */
            }
          }
        }
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (post && !image && !svgLoading) makeGraphic(post, undefined, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  const regenerateAll = useCallback(async () => {
    if (loading) return;
    await generate();
  }, [loading, generate]);

  const redoBody = useCallback(async () => {
    if (!post || loading || !bodyNote.trim()) return;
    await generate({ keepTopic: true, note: bodyNote });
    setBodyNote("");
  }, [post, loading, bodyNote, generate]);

  const revert = useCallback(async (turnId: string) => {
    setReverting(turnId);
    try {
      const res = await fetch("/api/social/train/revert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnId }),
      });
      if (res.ok) {
        const state = await res.json();
        setTurns(state.turns ?? []);
        if (state.pending) setPost(state.pending);
        setSaved(false);
      }
    } finally {
      setReverting(null);
    }
  }, []);

  const confirmCorrection = useCallback(async () => {
    if (!correction || (!corrStatement.trim() && !corrAvoid.trim())) return;
    setCorrState("saving");
    try {
      const res = await fetch("/api/social/train/correction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: correction.category, statement: corrStatement.trim(), avoid: corrAvoid.trim() || undefined }),
      });
      setCorrState(res.ok ? "saved" : "idle");
    } catch {
      setCorrState("idle");
    }
  }, [correction, corrStatement, corrAvoid]);

  const savePost = useCallback(async () => {
    if (!post || saving || saved) return;
    setSaving(true);
    try {
      const res = await fetch("/api/social/train/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [post, saving, saved]);

  async function startNew() {
    if (post) await fetch("/api/social/train/save", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    await fetch("/api/social/train", { method: "DELETE" });
    setPost(null);
    setTurns([]);
    setTopic("");
    setPostTopic("");
    setBodyNote("");
    setArtDirection("");
    setImage(null);
    setSvg(null);
    setCorrection(null);
    setSaved(false);
  }

  if (!booted) return <div className="placeholder">Loading…</div>;

  if (!post) {
    return (
      <div className="pg-start">
        <div className="prompt-screen">
          <h1 className="prompt-title">Start a post</h1>
          <p className="prompt-tag">Describe the post, or let the AI pick a topic. You can keep refining it after.</p>
          {error && <div className="placeholder err">{error} {error.includes("ingest") && <Link href="/knowledge" className="chip">Ingest material</Link>}</div>}
          <div className="prompt-box">
            <textarea
              className="prompt-input"
              rows={3}
              value={topic}
              placeholder="post focussed on efficiency with LIMS, for senior analysts"
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && topic.trim()) { e.preventDefault(); regenerateAll(); } }}
            />
            <div className="prompt-actions">
              <button className="btn ghost" disabled={loading} onClick={() => generate({ auto: true })} title="Let the AI choose the topic">
                {loading && !topic.trim() ? "Generating…" : "Auto-generate with AI"}
              </button>
              <button className="btn" disabled={loading || !topic.trim()} onClick={() => regenerateAll()}>
                {loading && topic.trim() ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
          <Link href="/saved" className="prompt-saved-link">Open a saved post to keep refining it →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pg3">
      {/* LEFT — composer */}
      <aside className="pg3-controls">
        <div className="pg3-head">
          <h1>Playground</h1>
          <button className="btn ghost small" onClick={startNew} title="Save this and start a fresh post">New</button>
        </div>

        <section className="sec">
          <div className="sec-head">Overall</div>
          <textarea className="topic-box" rows={3} value={topic} placeholder="Topic for the post. Edit it, then Regenerate." onChange={(e) => setTopic(e.target.value)} />
          <button className="btn full" disabled={loading || !topicDirty} onClick={() => regenerateAll()} title={topicDirty ? "Rebuild body + media from this topic" : "Edit the topic to enable"}>
            {redoKind === "new" && loading ? "Regenerating…" : "Regenerate post"}
          </button>
        </section>

        <section className="sec">
          <div className="sec-head">Body</div>
          <textarea
            className="topic-box"
            rows={3}
            value={bodyNote}
            placeholder='What to change? e.g. "punchier hook", "results never sit in email".'
            onChange={(e) => setBodyNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); redoBody(); } }}
          />
          <button className="btn full" disabled={loading || !bodyNote.trim()} onClick={() => redoBody()} title={bodyNote.trim() ? "Rewrite the copy (keeps media)" : "Enter feedback to enable"}>
            {redoKind === "body" && loading ? "Rewriting…" : "Redo body"}
          </button>

          {correction && (
            <div className="factfix">
              <div className="factfix-h">Looks like a correction<span className={`corr-tag corr-${correction.category}`}>{correction.category}</span></div>
              <p className="factfix-sub">{correction.summary}</p>
              <label className="factfix-label">Remember &rarr; <strong>{correction.destinationLabel}</strong></label>
              <textarea className="topic-box" rows={2} value={corrStatement} onChange={(e) => { setCorrStatement(e.target.value); setCorrState("idle"); }} />
              {correction.category === "world" && (
                <>
                  <label className="factfix-label">Misconception to avoid</label>
                  <textarea className="topic-box" rows={2} value={corrAvoid} placeholder="e.g. Results sit in analysts' email inboxes." onChange={(e) => { setCorrAvoid(e.target.value); setCorrState("idle"); }} />
                </>
              )}
              <div className="factfix-cta">
                {corrState === "saved" ? (
                  <span className="factfix-done">✓ Saved</span>
                ) : (
                  <>
                    <button className="btn" disabled={corrState === "saving" || (!corrStatement.trim() && !corrAvoid.trim())} onClick={() => confirmCorrection()}>
                      {corrState === "saving" ? "Saving…" : "Teach the Brain"}
                    </button>
                    <button className="btn ghost" onClick={() => setCorrection(null)}>Dismiss</button>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="sec">
          <div className="sec-head">Media</div>
          <textarea
            className="topic-box"
            rows={2}
            value={artDirection}
            placeholder='How should the graphic change? e.g. "use a chart".'
            onChange={(e) => setArtDirection(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && post) { e.preventDefault(); makeGraphic(post, artDirection.trim() || undefined); } }}
          />
          <button className="btn full" disabled={svgLoading || loading || !artDirection.trim()} onClick={() => post && makeGraphic(post, artDirection.trim() || undefined)} title={artDirection.trim() ? "Regenerate the graphic" : "Enter a direction to enable"}>
            {svgLoading ? "Drawing…" : "Redo media"}
          </button>
        </section>
      </aside>

      {/* CENTER — the conversation (inputs + outputs only) */}
      <section className="pg3-chat" ref={feedRef}>
        {turns.map((t) => (
          <ChatTurn key={t.id} turn={t} onRevert={revert} reverting={reverting === t.id} />
        ))}
        {loading && <div className="chat-thinking">{redoKind === "body" ? "Rewriting the copy…" : "Writing…"}</div>}
      </section>

      {/* RIGHT — live preview + save */}
      <aside className="pg3-preview">
        <div className="pg3-preview-head">
          <span className="eyebrow">Preview</span>
          <button className={`btn small save-standard ${saved ? "is-saved" : ""}`} disabled={saving || saved} onClick={savePost} title="Save this post with its full history">
            {saved ? "★ Saved" : saving ? "Saving…" : "☆ Save post"}
          </button>
        </div>
        <FeedCard post={post} image={image} svgLoading={svgLoading} />
        <div className="pg3-dl">
          {image && <button className="link-btn" onClick={() => downloadDataUrl(image, post.theme, "png")}>Download PNG</button>}
          {svg && <button className="link-btn" onClick={() => downloadText(svg, post.theme, "svg")}>Download SVG</button>}
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
      </aside>
    </div>
  );
}

function ChatTurn({ turn, onRevert, reverting }: { turn: Turn; onRevert: (id: string) => void; reverting: boolean }) {
  if (turn.role === "user") {
    const label = turn.channel === "topic" ? "Topic" : turn.channel === "media" ? "Media" : "Body";
    return (
      <div className="ct ct-user">
        <div className="ct-role">{label}</div>
        <div className="ct-bubble">{turn.text}</div>
      </div>
    );
  }

  // assistant
  const isBody = turn.channel === "body";
  const hasBefore = isBody && typeof turn.prevBody === "string" && turn.prevBody.trim().length > 0 && turn.prevBody !== turn.body;
  return (
    <div className="ct ct-ai">
      <div className="ct-role">AI</div>
      <div className="ct-ai-body">
        <div className="ct-ai-head">
          <span className="ct-ai-label">{turn.text}</span>
          {isBody && turn.body && (
            <button className="ct-revert" disabled={reverting} onClick={() => onRevert(turn.id)} title="Make this version the current copy">
              {reverting ? "Reverting…" : "↩ Revert to this"}
            </button>
          )}
        </div>
        {isBody && (
          hasBefore ? (
            <div className="ct-diff">
              <div className="ct-diff-col ct-before">
                <div className="ct-diff-h">Before</div>
                <div className="ct-diff-text">{displayBody(turn.prevBody!)}</div>
              </div>
              <div className="ct-diff-col ct-after">
                <div className="ct-diff-h">After</div>
                <div className="ct-diff-text">{displayBody(turn.body!)}</div>
              </div>
            </div>
          ) : (
            turn.body && <div className="ct-ai-copy">{displayBody(turn.body)}</div>
          )
        )}
        {turn.channel === "media" && turn.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ct-ai-img" src={turn.image} alt="Graphic revision" />
        )}
      </div>
    </div>
  );
}

function displayBody(body: string): string {
  return body
    .replace(/\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "")
    .replace(/[ \t]+([.?!,:;])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
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

function FeedCard({ post, image, svgLoading }: { post: Post; image: string | null; svgLoading: boolean }) {
  const tags = post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const cleanBody = displayBody(post.body);
  const full = tags ? `${cleanBody}\n\n${tags}` : cleanBody;

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
      <div className="feed-body">{full}</div>
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
