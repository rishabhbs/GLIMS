"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Citation = { claim: string; itemIds: string[]; sourceIds: string[] };
type UsedItem = { id: string; title: string; entityType: string; status: string };
type UsedSource = { id: string; title: string | null; type: string };
type Conflict = { itemIds: string[]; note: string };

type WebCitation = {
  findingId: string;
  title: string | null;
  url: string;
  excerpt: string | null;
  publishedDate: string | null;
  retrievedAt: string;
  isPrimarySource: boolean;
};

type AssistantMeta = {
  messageId: string;
  groundingStatus: "grounded" | "partial" | "insufficient";
  citations: Citation[];
  usedItems: UsedItem[];
  usedSources: UsedSource[];
  conflicts: Conflict[];
  researched: boolean;
  webCitations: WebCitation[];
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  meta?: AssistantMeta;
};

type ConversationSummary = { id: string; title: string | null; messageCount: number; updatedAt: string };

type ProposedChange = {
  kind: "edit" | "create" | "outdate";
  itemId?: string;
  currentUnderstanding?: string;
  proposedUnderstanding: string;
  rationale: string;
};

type Preview = {
  conversationId: string;
  correctionText: string;
  affectedItemIds: string[];
  proposedChanges: ProposedChange[];
  wouldConflictWithConfirmed: boolean;
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  grounded: { text: "Grounded", cls: "ok" },
  partial: { text: "Partially grounded", cls: "warn" },
  insufficient: { text: "No supported knowledge", cls: "danger" },
};

export function AskClient() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [forceResearch, setForceResearch] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Correction state (per assistant message index being corrected).
  const [correctingIdx, setCorrectingIdx] = useState<number | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [appliedNote, setAppliedNote] = useState<{ idx: number; itemIds: string[] } | null>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    const data = await res.json();
    if (data.conversations) setConversations(data.conversations);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function openConversation(id: string) {
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    if (!data.conversation) return;
    setConversationId(id);
    setMessages(
      data.conversation.messages
        .filter((m: { role: string }) => m.role !== "system")
        .map((m: { role: string; content: string; groundingStatus: string | null; citations: Citation[] | null; id: string }) => ({
          role: m.role,
          content: m.content,
          meta:
            m.role === "assistant"
              ? {
                  messageId: m.id,
                  groundingStatus: (m.groundingStatus ?? "insufficient") as AssistantMeta["groundingStatus"],
                  citations: m.citations ?? [],
                  usedItems: [],
                  usedSources: [],
                  conflicts: [],
                }
              : undefined,
        })),
    );
    resetCorrection();
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    resetCorrection();
  }

  function resetCorrection() {
    setCorrectingIdx(null);
    setCorrectionText("");
    setPreview(null);
    setAppliedNote(null);
  }

  async function send() {
    const q = input.trim();
    if (!q || sending) return;
    setSending(true);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "…", meta: undefined }]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, question: q, researchMode: forceResearch ? "always" : "auto" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: `Error: ${data.error}` };
          return copy;
        });
        return;
      }
      if (!conversationId) {
        setConversationId(data.conversationId);
        loadConversations();
      }
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content: data.answer,
          meta: {
            messageId: data.messageId,
            groundingStatus: data.groundingStatus,
            citations: data.citations,
            usedItems: data.usedItems,
            usedSources: data.usedSources,
            conflicts: data.conflicts,
            researched: data.researched,
            webCitations: data.webCitations ?? [],
          },
        };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  // ── Correction flow ──────────────────────────────────────────────────────
  function startCorrection(idx: number) {
    setCorrectingIdx(idx);
    setCorrectionText("");
    setPreview(null);
    setAppliedNote(null);
  }

  async function doPreview() {
    if (correctingIdx === null || !correctionText.trim() || !conversationId) return;
    setPreviewing(true);
    try {
      const messageId = messages[correctingIdx].meta?.messageId;
      const res = await fetch("/api/corrections/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, messageId, correctionText }),
      });
      const data = await res.json();
      if (res.ok) setPreview(data.preview);
    } finally {
      setPreviewing(false);
    }
  }

  async function applyCorrection() {
    if (!preview || correctingIdx === null || !conversationId) return;
    setApplying(true);
    try {
      const messageId = messages[correctingIdx].meta?.messageId;
      const res = await fetch("/api/corrections/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messageId,
          correctionText: preview.correctionText,
          proposedChanges: preview.proposedChanges,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAppliedNote({ idx: correctingIdx, itemIds: data.result.changedItemIds });
        setPreview(null);
        setCorrectingIdx(null);
        setCorrectionText("");
      }
    } finally {
      setApplying(false);
    }
  }

  async function promote(w: WebCitation) {
    setPromoting(w.findingId);
    try {
      const title = (w.title ?? w.url).slice(0, 60);
      const claim = w.excerpt?.trim() || title;
      const res = await fetch("/api/research/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingId: w.findingId, entityType: "limitation", title, claim }),
      });
      const data = await res.json();
      if (res.ok) {
        window.open(`/item/${data.itemId}`, "_blank");
      }
    } finally {
      setPromoting(null);
    }
  }

  return (
    <div className="ask-layout">
      <div className="conv-list">
        <button className="btn full" onClick={newConversation}>+ New conversation</button>
        {conversations.map((c) => (
          <button
            key={c.id}
            className={`conv ${c.id === conversationId ? "active" : ""}`}
            onClick={() => openConversation(c.id)}
          >
            <div className="conv-title">{c.title ?? "Untitled"}</div>
            <div className="conv-meta">{c.messageCount} msgs</div>
          </button>
        ))}
      </div>

      <div className="chat">
        <div className="chat-head">
          <h1 style={{ margin: 0 }}>Ask the Brain</h1>
          <p className="lead" style={{ margin: "2px 0 0" }}>
            Grounded answers from ingested knowledge. Correct any answer to teach the Brain.
          </p>
        </div>

        <div className="thread" ref={threadRef}>
          {messages.length === 0 && (
            <div className="empty">
              Ask a question about Sampleify. Answers cite the knowledge items and sources behind them.
            </div>
          )}
          {messages.map((m, idx) => (
            <div key={idx} className={`bubble ${m.role}`}>
              <div className="bubble-body">{m.content}</div>

              {m.meta && (
                <div className="meta">
                  <GroundingBadge status={m.meta.groundingStatus} />
                  {m.meta.researched && <span className="badge">web researched</span>}
                  {m.meta.conflicts.length > 0 && (
                    <span className="badge danger">conflict — see Admin</span>
                  )}
                  {m.meta.usedItems.map((it) => (
                    <Link key={it.id} href={`/item/${it.id}`} className="cite" target="_blank">
                      ↳ {it.title}
                    </Link>
                  ))}
                </div>
              )}

              {m.meta && m.meta.webCitations.length > 0 && (
                <div className="web-cites">
                  <div className="web-cites-head">External sources</div>
                  {m.meta.webCitations.map((w) => (
                    <div key={w.findingId} className="web-cite">
                      <div className="web-cite-main">
                        <a href={w.url} target="_blank" rel="noreferrer" className="web-link">
                          {w.isPrimarySource && <span className="badge ok">primary</span>} {w.title ?? w.url}
                        </a>
                        <div className="web-meta">
                          {new URL(w.url).hostname}
                          {w.publishedDate ? ` · ${w.publishedDate}` : ""} · retrieved {new Date(w.retrievedAt).toLocaleDateString()}
                        </div>
                        {w.excerpt && <div className="web-excerpt">“{w.excerpt}”</div>}
                      </div>
                      <button
                        className="btn ghost small"
                        disabled={promoting === w.findingId}
                        onClick={() => promote(w)}
                        title="Add this finding to the Brain as a candidate item (you review it)"
                      >
                        {promoting === w.findingId ? "Promoting…" : "Promote to Brain"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {m.role === "assistant" && m.meta && (
                <div className="correct-row">
                  {appliedNote?.idx === idx ? (
                    <span className="applied">
                      ✓ Knowledge updated.{" "}
                      {appliedNote.itemIds.map((id) => (
                        <Link key={id} href={`/item/${id}`} target="_blank" className="link">
                          view item
                        </Link>
                      ))}
                    </span>
                  ) : correctingIdx === idx ? null : (
                    <button className="link-btn" onClick={() => startCorrection(idx)}>
                      This is wrong or incomplete — correct it
                    </button>
                  )}
                </div>
              )}

              {correctingIdx === idx && (
                <div className="correction-box">
                  <label>Provide the correct information:</label>
                  <textarea
                    rows={3}
                    value={correctionText}
                    onChange={(e) => setCorrectionText(e.target.value)}
                    placeholder="e.g. Sample allocation happens immediately after receiving; approval occurs later."
                  />
                  {!preview ? (
                    <div className="row-btns">
                      <button className="btn" disabled={previewing || !correctionText.trim()} onClick={doPreview}>
                        {previewing ? "Analyzing…" : "Preview change"}
                      </button>
                      <button className="btn ghost" onClick={resetCorrection}>Cancel</button>
                    </div>
                  ) : (
                    <div className="preview">
                      <div className="preview-title">Proposed knowledge change — review before applying</div>
                      {preview.wouldConflictWithConfirmed && (
                        <div className="warn-line">⚠ This would change a confirmed item. Please review carefully.</div>
                      )}
                      {preview.proposedChanges.map((ch, i) => (
                        <div key={i} className="change">
                          <span className="badge">{ch.kind}</span>
                          <div className="change-body">
                            {ch.currentUnderstanding && (
                              <div className="before">
                                <span className="lbl">Now:</span> {ch.currentUnderstanding}
                              </div>
                            )}
                            <div className="after">
                              <span className="lbl">After:</span> {ch.proposedUnderstanding}
                            </div>
                            <div className="rationale">{ch.rationale}</div>
                          </div>
                        </div>
                      ))}
                      <div className="row-btns">
                        <button className="btn apply" disabled={applying} onClick={applyCorrection}>
                          {applying ? "Applying…" : "Apply correction"}
                        </button>
                        <button className="btn ghost" onClick={() => setPreview(null)}>Back</button>
                        <button className="btn ghost" onClick={resetCorrection}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="composer-wrap">
          <label className="research-toggle" title="Force live web research for this question">
            <input type="checkbox" checked={forceResearch} onChange={(e) => setForceResearch(e.target.checked)} />
            Research the web
          </label>
          <div className="composer">
            <textarea
              rows={2}
              value={input}
              placeholder="Ask about Sampleify…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="btn send" disabled={sending || !input.trim()} onClick={send}>
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{styles}</style>
    </div>
  );
}

function GroundingBadge({ status }: { status: "grounded" | "partial" | "insufficient" }) {
  const s = STATUS_LABEL[status];
  return <span className={`badge ${s.cls}`}>{s.text}</span>;
}

const styles = `
  .ask-layout { display: grid; grid-template-columns: 232px 1fr; gap: var(--space-xl); height: calc(100vh - var(--space-xl) * 2); }
  .conv-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; padding-right: var(--space-2xs); }
  .conv {
    text-align: left; background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 10px 12px; cursor: pointer; color: var(--text-soft);
    transition: border-color 0.15s var(--ease-out), background 0.15s var(--ease-out);
  }
  .conv:hover { border-color: var(--border-2); background: var(--panel-2); }
  .conv.active { border-color: color-mix(in oklch, var(--accent) 50%, transparent); background: var(--panel-2); }
  .conv-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .conv-meta { font-size: 11px; color: var(--faint); margin-top: 3px; }

  .chat { display: flex; flex-direction: column; min-width: 0; }
  .chat-head { padding-bottom: var(--space-md); border-bottom: 1px solid var(--border); }
  .thread { flex: 1; overflow-y: auto; padding: var(--space-md) 2px; display: flex; flex-direction: column; gap: var(--space-md); }
  .empty { color: var(--muted); border: 1px dashed var(--border-2); border-radius: var(--radius-md); padding: var(--space-lg); line-height: 1.65; background: var(--panel); }

  .bubble { max-width: 86%; animation: ask-bubble-in 0.35s var(--ease-out) both; }
  @keyframes ask-bubble-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .bubble.user { align-self: flex-end; }
  .bubble.assistant { align-self: flex-start; width: 86%; }
  .bubble-body { padding: 12px 15px; border-radius: var(--radius-md); white-space: pre-wrap; line-height: 1.6; }
  .bubble.user .bubble-body {
    background: var(--accent-soft); color: var(--text);
    border: 1px solid color-mix(in oklch, var(--accent) 30%, transparent);
    border-bottom-right-radius: var(--space-2xs);
  }
  .bubble.assistant .bubble-body { background: var(--panel); border: 1px solid var(--border); border-bottom-left-radius: var(--space-2xs); }

  .meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; align-items: center; }
  .cite {
    font-size: 11px; padding: 3px 9px; border-radius: 999px;
    border: 1px solid color-mix(in oklch, var(--cool) 35%, transparent);
    color: var(--cool); background: var(--cool-soft);
    transition: border-color 0.15s var(--ease-out);
  }
  .cite:hover { border-color: var(--cool); }
  .cite.src { color: var(--muted); border-color: var(--border-2); background: var(--panel); }

  .correct-row { margin-top: 8px; }
  .link-btn { background: none; border: none; color: var(--faint); font-size: 13px; cursor: pointer; padding: 0; transition: color 0.15s var(--ease-out); }
  .link-btn:hover { color: var(--accent); }
  .applied { font-size: 13px; color: var(--ok); }
  .link { color: var(--cool); margin-left: 6px; }

  .correction-box { margin-top: var(--space-sm); background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-md); }
  .correction-box label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 7px; }
  .correction-box textarea, .composer textarea {
    width: 100%; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text); padding: 11px 13px; font: inherit; resize: vertical;
    transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
  }
  .correction-box textarea:focus, .composer textarea:focus {
    outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .row-btns { display: flex; gap: var(--space-xs); margin-top: var(--space-sm); }

  .preview { margin-top: var(--space-sm); }
  .preview-title { font-family: var(--font-display); font-weight: 600; margin-bottom: var(--space-xs); }
  .warn-line { color: var(--warn); font-size: 13px; margin-bottom: var(--space-xs); }
  .change { display: flex; gap: var(--space-sm); padding: var(--space-xs) 0; border-top: 1px solid var(--border); }
  .change-body { font-size: 14px; }
  .before { color: var(--faint); text-decoration: line-through; }
  .after { color: var(--text); }
  .lbl { color: var(--faint); font-size: 12px; margin-right: 4px; }
  .rationale { color: var(--muted); font-size: 12px; margin-top: 4px; }

  .composer-wrap { padding-top: var(--space-md); border-top: 1px solid var(--border); }
  .research-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); margin-bottom: var(--space-xs); cursor: pointer; }
  .composer { display: flex; gap: var(--space-xs); align-items: flex-end; }
  .composer textarea { flex: 1; }

  .web-cites { margin-top: var(--space-xs); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-sm); background: var(--panel); }
  .web-cites-head { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin-bottom: 7px; }
  .web-cite { display: flex; gap: var(--space-sm); justify-content: space-between; align-items: flex-start; padding: var(--space-xs) 0; border-top: 1px solid var(--border); }
  .web-cite:first-of-type { border-top: none; }
  .web-cite-main { min-width: 0; }
  .web-link { color: var(--cool); font-size: 14px; }
  .web-meta { font-size: 11px; color: var(--faint); margin-top: 2px; }
  .web-excerpt { font-size: 13px; color: var(--text-soft); margin-top: 4px; }

  .btn {
    background: var(--accent); color: var(--accent-ink); border: 1px solid transparent;
    border-radius: var(--radius-sm); padding: 9px 16px; cursor: pointer; font-weight: 600; font-size: 13.5px;
    transition: filter 0.15s var(--ease-out), transform 0.05s ease;
  }
  .btn:hover:not(:disabled) { filter: brightness(1.08); }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn:disabled { opacity: 0.45; cursor: default; }
  .btn.ghost { background: var(--panel-2); color: var(--text-soft); border-color: var(--border-2); }
  .btn.ghost:hover:not(:disabled) { background: var(--raised); filter: none; }
  .btn.apply { background: var(--ok); color: var(--bg); }
  .btn.full { width: 100%; }
  .btn.send { align-self: stretch; }
  .btn.small { padding: 6px 12px; font-size: 12px; white-space: nowrap; }

  @media (prefers-reduced-motion: reduce) { .bubble { animation: none; } }
`;
