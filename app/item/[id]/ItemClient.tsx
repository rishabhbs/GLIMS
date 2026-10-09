"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge, ClassificationBadge } from "../../_components/StatusBadge";

type Evidence = { id: string; sourceId: string; sourceTitle: string | null; sourceType: string; snippet: string | null };
type Related = { relationshipType: string; direction: string; item: { id: string; title: string; entityType: string; status: string }; note: string | null };
type Item = {
  id: string;
  entityType: string;
  title: string;
  claim: string;
  body: string | null;
  status: string;
  sourceClassification: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  evidence: Evidence[];
  related: Related[];
};
type Change = { id: string; changeType: string; cause: string; createdAt: string };

const STATUSES = ["candidate", "confirmed", "interpretation", "outdated", "conflicted", "unknown"];

export function ItemClient({ item, history }: { item: Item; history: Change[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [claim, setClaim] = useState(item.claim);
  const [body, setBody] = useState(item.body ?? "");
  const [busy, setBusy] = useState(false);

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/items/${item.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    setBusy(true);
    try {
      await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, claim, body, reason: "manual edit via Item view" }),
      });
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link href="/explorer" style={{ color: "var(--muted)", fontSize: 13 }}>← Explorer</Link>

      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span className="badge">{item.entityType}</span>
          <ClassificationBadge classification={item.sourceClassification} />
          <StatusBadge status={item.status} />
          <span className="badge">conf {item.confidence.toFixed(2)}</span>
        </div>

        {editing ? (
          <div style={{ display: "grid", gap: 10 }}>
            <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="in" rows={3} value={claim} onChange={(e) => setClaim(e.target.value)} />
            <textarea className="in" rows={4} placeholder="Body (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" disabled={busy} onClick={saveEdit}>Save (versioned)</button>
              <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <h1 style={{ marginBottom: 4 }}>{item.title}</h1>
            <p style={{ fontSize: 16 }}>{item.claim}</p>
            {item.body && <p style={{ color: "var(--muted)" }}>{item.body}</p>}
            <button className="btn" onClick={() => setEditing(true)}>Edit / Correct</button>
          </>
        )}
      </div>

      <h2>Curation</h2>
      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ color: "var(--muted)", fontSize: 13 }}>Set status:</label>
        <select
          className="in"
          defaultValue={item.status}
          disabled={busy}
          onChange={(e) => act({ action: "status", status: e.target.value })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className="btn ghost" disabled={busy} onClick={() => act({ action: "archive" })}>Archive</button>
        <button className="btn ghost" disabled={busy} onClick={() => act({ action: "invalidate" })}>Invalidate</button>
      </div>

      <h2>Sources / Evidence</h2>
      <div className="card">
        {item.evidence.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No evidence linked.</p>
        ) : (
          item.evidence.map((e) => (
            <div key={e.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>{e.sourceType} · {e.sourceTitle ?? "(untitled source)"}</div>
              {e.snippet && <blockquote style={{ margin: "4px 0 0", color: "var(--text)" }}>“{e.snippet}”</blockquote>}
            </div>
          ))
        )}
      </div>

      <h2>Related knowledge</h2>
      <div className="card">
        {item.related.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No related items.</p>
        ) : (
          item.related.map((r, i) => (
            <Link key={i} href={`/item/${r.item.id}`} className="rel">
              <span className="badge">{r.direction === "outgoing" ? r.relationshipType : `← ${r.relationshipType}`}</span>
              <span>{r.item.title}</span>
              <StatusBadge status={r.item.status} />
            </Link>
          ))
        )}
      </div>

      <h2>History</h2>
      <div className="card">
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Created {new Date(item.createdAt).toLocaleString()} · Updated {new Date(item.updatedAt).toLocaleString()}
        </div>
        {history.length === 0 ? (
          <p style={{ color: "var(--muted)", marginTop: 8 }}>No recorded changes.</p>
        ) : (
          history.map((h) => (
            <div key={h.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
              <span className="badge">{h.changeType}</span> via {h.cause} · {new Date(h.createdAt).toLocaleString()}
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        .in { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 10px; font: inherit; }
        .btn { background: var(--accent); color: white; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
        .btn.ghost { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
        .btn:disabled { opacity: 0.5; }
        .rel { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
        .rel:hover { background: var(--panel-2); }
      `}</style>
    </div>
  );
}
