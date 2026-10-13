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

type ProductOpt = { id: string; slug: string; name: string };

export function PlaygroundClient() {
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [productId, setProductId] = useState<string>("");
  const [post, setPost] = useState<Post | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [topic, setTopic] = useState("");
  // Single composer: which channel the message targets, and the draft text.
  const [channel, setChannel] = useState<"post" | "body" | "media">("body");
  const [draft, setDraft] = useState("");
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

  const feedRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Current product id, kept in a ref so the fetch helpers always see the
  // latest value without being in every callback's dependency list.
  const pidRef = useRef<string>("");
  useEffect(() => { pidRef.current = productId; }, [productId]);

  // Fetch helpers that always inject the active product.
  const trainGet = useCallback(() => {
    const q = pidRef.current ? `?product=${encodeURIComponent(pidRef.current)}` : "";
    return fetch(`/api/social/train${q}`);
  }, []);
  const postJson = useCallback((url: string, body: Record<string, unknown> = {}) => {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, productId: pidRef.current || undefined }),
    });
  }, []);

  // Auto-grow the composer to fit its content, up to ~5 lines, then scroll.
  const autosize = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);
  // Re-fit whenever the draft changes (typing, Post pre-fill, or clear on send).
  useEffect(() => { autosize(); }, [draft, autosize]);

  // The most recent assistant body turn IS the current copy, so revert is
  // pointless on it — we hide the button there.
  const latestBodyTurnId = [...turns].reverse().find((t) => t.role === "assistant" && t.channel === "body")?.id ?? null;

  // When the Post channel is active, keep the draft showing the current topic
  // (so after an auto-generate or a Post regenerate, the box reflects what the
  // post is actually built on).
  useEffect(() => {
    if (channel === "post") setDraft(topic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, channel]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, loading]);

  const refreshTurns = useCallback(async () => {
    const res = await trainGet();
    if (res.ok) {
      const state = await res.json();
      setTurns(state.turns ?? []);
      if (state.pending) {
        setPost(state.pending);
        setImage(state.pending.image ?? null);
      }
    }
  }, [trainGet]);

  const generate = useCallback(
    async (opts?: { keepTopic?: boolean; auto?: boolean; note?: string; topicOverride?: string }) => {
      const keepTopic = !!opts?.keepTopic;
      const sendTopic = keepTopic || opts?.auto
        ? undefined
        : (opts?.topicOverride ?? topic).trim() || undefined;
      setRedoKind(keepTopic ? "body" : "new");
      setLoading(true);
      setError(null);
      try {
        const res = await postJson("/api/social/train", { topic: sendTopic, keepTopic, note: opts?.note?.trim() || undefined });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Generation failed.");
          if (!keepTopic) setPost(null);
          return;
        }
        setPost(data);
        setTopic(data.topic ?? "");
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
        const res = await postJson("/api/social/graphic", { postId: p.id, body: p.body, theme: p.theme, direction, record });
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
    [refreshTurns, postJson],
  );

  // Load the active product's pending state into the view (used on boot and
  // whenever the product changes).
  const loadProductState = useCallback(async () => {
    // Clear the current view first so stale content never bleeds across products.
    setPost(null); setTurns([]); setTopic(""); setImage(null); setSvg(null);
    setCorrection(null); setSaved(false);
    const res = await trainGet();
    if (!res.ok) return;
    const state = await res.json();
    if (state.pending) {
      setPost(state.pending);
      setTurns(state.turns ?? []);
      setTopic(state.pending.topic ?? "");
      if (state.pending.image) setImage(state.pending.image);
    }
  }, [trainGet]);

  // Boot: load products, choose the active one (saved choice or first), then
  // load its state.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/social/products");
        const list: ProductOpt[] = res.ok ? (await res.json()).products ?? [] : [];
        setProducts(list);
        const saved = typeof window !== "undefined" ? localStorage.getItem("glims.product") : null;
        const active = (saved && list.some((p) => p.id === saved) ? saved : list[0]?.id) ?? "";
        setProductId(active);
        pidRef.current = active;
        await loadProductState();
      } finally {
        setBooted(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching product: persist the choice and reload that product's state.
  const switchProduct = useCallback(
    async (id: string) => {
      if (id === productId) return;
      setProductId(id);
      pidRef.current = id;
      if (typeof window !== "undefined") localStorage.setItem("glims.product", id);
      await loadProductState();
    },
    [productId, loadProductState],
  );

  useEffect(() => {
    if (post && !image && !svgLoading) makeGraphic(post, undefined, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  // Start-screen generate (first post from the typed topic).
  const regenerateAll = useCallback(async () => {
    if (loading) return;
    await generate({ topicOverride: topic });
  }, [loading, generate, topic]);

  // Switching the composer channel. "Post" pre-fills the draft with the current
  // working topic so it's visible and editable; Body/Media start empty.
  const selectChannel = useCallback(
    (c: "post" | "body" | "media") => {
      setChannel(c);
      setDraft(c === "post" ? topic : "");
    },
    [topic],
  );

  // The single composer send — routes the message by the selected channel.
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || loading || svgLoading) return;
    const ch: Turn["channel"] = channel === "post" ? "topic" : channel;
    // Optimistically show the user's message immediately. The server response's
    // refreshTurns() replaces this with the authoritative timeline (which
    // includes this turn), so there's no duplicate.
    const optimistic: Turn = { id: `optimistic_${Date.now()}`, role: "user", channel: ch, text, createdAt: new Date().toISOString() };
    setTurns((prev) => [...prev, optimistic]);
    setDraft("");
    if (channel === "post") {
      await generate({ topicOverride: text });
    } else if (channel === "body") {
      if (!post) return;
      await generate({ keepTopic: true, note: text });
    } else {
      if (!post) return;
      await makeGraphic(post, text);
    }
  }, [draft, channel, loading, svgLoading, post, generate, makeGraphic]);

  const revert = useCallback(async (turnId: string) => {
    setReverting(turnId);
    try {
      const res = await postJson("/api/social/train/revert", { turnId });
      if (res.ok) {
        const state = await res.json();
        setTurns(state.turns ?? []);
        if (state.pending) setPost(state.pending);
        setSaved(false);
      }
    } finally {
      setReverting(null);
    }
  }, [postJson]);

  // Inline-edit an assistant body bubble: save the edited copy verbatim.
  const editTurn = useCallback(async (turnId: string, body: string) => {
    const res = await postJson("/api/social/train/edit", { turnId, body });
    if (res.ok) {
      const state = await res.json();
      setTurns(state.turns ?? []);
      if (state.pending) setPost(state.pending);
      setSaved(false);
    }
  }, [postJson]);

  const confirmCorrection = useCallback(async () => {
    if (!correction || (!corrStatement.trim() && !corrAvoid.trim())) return;
    setCorrState("saving");
    try {
      const res = await postJson("/api/social/train/correction", {
        category: correction.category,
        statement: corrStatement.trim(),
        avoid: corrAvoid.trim() || undefined,
      });
      setCorrState(res.ok ? "saved" : "idle");
    } catch {
      setCorrState("idle");
    }
  }, [correction, corrStatement, corrAvoid, postJson]);

  const savePost = useCallback(async () => {
    if (!post || saving || saved) return;
    setSaving(true);
    try {
      const res = await postJson("/api/social/train/save", {});
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [post, saving, saved, postJson]);

  async function startNew() {
    if (post) await postJson("/api/social/train/save", {}).catch(() => {});
    const q = pidRef.current ? `?product=${encodeURIComponent(pidRef.current)}` : "";
    await fetch(`/api/social/train${q}`, { method: "DELETE" });
    setPost(null);
    setTurns([]);
    setTopic("");
    setDraft("");
    setChannel("body");
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
          <div className="product-picker product-picker-center">
            <span className="product-picker-label">Writing for</span>
            <select className="product-select" value={productId} onChange={(e) => switchProduct(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
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
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && topic.trim()) { e.preventDefault(); regenerateAll(); } }}
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

  const busy = loading || svgLoading;
  const placeholder =
    channel === "post"
      ? "Describe the whole post, e.g. \"efficiency for senior analysts, lead with a number\""
      : channel === "body"
        ? "Change the copy, e.g. \"punchier hook\", \"results never sit in email\""
        : "Change the graphic, e.g. \"use a chart\", \"more minimal\"";

  return (
    <div className="pg2">
      {/* LEFT — the conversation + bottom composer */}
      <section className="pg2-main">
        <div className="pg2-head">
          <div className="pg2-head-left">
            <h1>Playground</h1>
            <div className="product-picker">
              <select className="product-select" value={productId} onChange={(e) => switchProduct(e.target.value)}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <button className="btn ghost small" onClick={startNew} title="Save this and start a fresh post">New post</button>
        </div>

        <div className="pg2-chat" ref={feedRef}>
          {turns.map((t) => (
            <ChatTurn
              key={t.id}
              turn={t}
              onRevert={revert}
              onEdit={editTurn}
              reverting={reverting === t.id}
              isLatestBody={t.id === latestBodyTurnId}
            />
          ))}
          {busy && <div className="chat-thinking">{svgLoading ? "Designing the graphic…" : redoKind === "body" ? "Rewriting the copy…" : "Writing…"}</div>}

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
        </div>

        {/* Bottom composer: one box, a Post/Body/Media toggle. */}
        <div className="composer">
          <div className="composer-toggle">
            {(["post", "body", "media"] as const).map((c) => (
              <button
                key={c}
                className={`seg ${channel === c ? "on" : ""}`}
                onClick={() => selectChannel(c)}
                title={c === "post" ? "Edit the whole post's topic, then regenerate" : c === "body" ? "Rewrite the copy" : "Regenerate the graphic"}
              >
                {c === "post" ? "Post" : c === "body" ? "Body" : "Media"}
              </button>
            ))}
          </div>
          <div className="composer-row">
            <textarea
              ref={composerRef}
              className="composer-input"
              rows={1}
              value={draft}
              placeholder={placeholder}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            <button className="composer-send" disabled={busy || !draft.trim()} onClick={() => send()} title="Send (Enter)">
              {busy ? "…" : "↑"}
            </button>
          </div>
        </div>
      </section>

      {/* RIGHT — live preview + save */}
      <aside className="pg2-preview">
        <div className="pg2-preview-head">
          <span className="eyebrow">Preview</span>
          <button className={`btn small save-standard ${saved ? "is-saved" : ""}`} disabled={saving || saved} onClick={savePost} title="Save this post with its full history">
            {saved ? "★ Saved" : saving ? "Saving…" : "☆ Save post"}
          </button>
        </div>
        <FeedCard
          post={post}
          image={image}
          svg={svg}
          bodyLoading={loading && redoKind !== "new"}
          rebuilding={loading && redoKind === "new"}
          svgLoading={svgLoading}
        />
      </aside>
    </div>
  );
}

function ChatTurn({
  turn,
  onRevert,
  onEdit,
  reverting,
  isLatestBody,
}: {
  turn: Turn;
  onRevert: (id: string) => void;
  onEdit: (id: string, body: string) => Promise<void> | void;
  reverting: boolean;
  isLatestBody: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

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
  const copy = turn.body ? displayBody(turn.body) : "";

  function beginEdit() {
    setDraft(copy);
    setEditing(true);
  }
  async function update() {
    if (saving) return;
    setSaving(true);
    try {
      await onEdit(turn.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  // Editable copy block — click to edit, "Update" sits at the bottom-right.
  const editableCopy = (text: string, className: string) =>
    editing ? (
      <div className="ct-edit">
        <textarea className="ct-edit-area" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
        <div className="ct-edit-actions">
          <button className="btn ghost small" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          <button className="btn small" onClick={update} disabled={saving || !draft.trim()}>{saving ? "Updating…" : "Update"}</button>
        </div>
      </div>
    ) : (
      <div className={`${className} ct-editable`} role="button" tabIndex={0} title="Click to edit this copy" onClick={beginEdit}>
        {text}
      </div>
    );

  return (
    <div className="ct ct-ai">
      <div className="ct-role">AI</div>
      <div className="ct-ai-body">
        <div className="ct-ai-head">
          <span className="ct-ai-label">{turn.text}</span>
          {isBody && turn.body && !isLatestBody && !editing && (
            <button className="ct-revert" disabled={reverting} onClick={() => onRevert(turn.id)} title="Make this version the current copy">
              {reverting ? "Reverting…" : "↩ Revert to this"}
            </button>
          )}
        </div>
        {isBody && (
          hasBefore && !editing ? (
            <div className="ct-diff">
              <div className="ct-diff-col ct-before">
                <div className="ct-diff-h">Before</div>
                <div className="ct-diff-text">{displayBody(turn.prevBody!)}</div>
              </div>
              <div className="ct-diff-col ct-after">
                <div className="ct-diff-h">After</div>
                <div className="ct-diff-text ct-editable" role="button" tabIndex={0} title="Click to edit this copy" onClick={beginEdit}>
                  {copy}
                </div>
              </div>
            </div>
          ) : (
            turn.body && editableCopy(copy, "ct-ai-copy")
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

function FeedCard({
  post,
  image,
  svg,
  svgLoading,
  bodyLoading = false,
  rebuilding = false,
}: {
  post: Post;
  image: string | null;
  svg: string | null;
  svgLoading: boolean;
  bodyLoading?: boolean;
  rebuilding?: boolean;
}) {
  const tags = post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const cleanBody = displayBody(post.body);
  const full = tags ? `${cleanBody}\n\n${tags}` : cleanBody;
  // During a body rewrite (or full rebuild) the copy is stale — show a skeleton.
  const copyLoading = bodyLoading || rebuilding;
  // Media is stale during its own redraw, or during a full post rebuild.
  const mediaLoading = svgLoading || rebuilding;

  return (
    <div className={`feed ${rebuilding ? "feed-rebuilding" : ""}`}>
      <div className="feed-top">
        <div className="avatar">{AUTHOR.initials}</div>
        <div className="who">
          <div className="who-name">{AUTHOR.name} <span className="deg">· 1st</span></div>
          <div className="who-title">{AUTHOR.title}</div>
          <div className="who-time">2h · 🌐</div>
        </div>
        <button className="follow">＋ Follow</button>
      </div>
      <div className="feed-body">
        {copyLoading ? (
          <div className="sk-lines">
            <span className="sk-line" style={{ width: "92%" }} />
            <span className="sk-line" style={{ width: "78%" }} />
            <span className="sk-line" style={{ width: "85%" }} />
            <span className="sk-line" style={{ width: "60%" }} />
          </div>
        ) : (
          full
        )}
      </div>
      <div className="feed-image">
        {mediaLoading ? (
          <div className="feed-svg skeleton pulsing"><span className="sk-spinner" />Designing graphic…</div>
        ) : image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="feed-svg" src={image} alt="Post graphic" />
            <div className="feed-dl">
              <button className="feed-dl-btn" onClick={() => downloadDataUrl(image, post.theme, "png")}>PNG</button>
              {svg && <button className="feed-dl-btn" onClick={() => downloadText(svg, post.theme, "svg")}>SVG</button>}
            </div>
          </>
        ) : (
          <div className="feed-svg skeleton">No graphic</div>
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
