"use client";

/**
 * Lab facts editor — the Studio's model of how real laboratories work.
 *
 * Truths it must respect and misconceptions it must never state. Grows mostly
 * through fact corrections in Training ("results never sit in email"), but is
 * fully editable here. Injected into every generation as grounding so the
 * Studio stops inventing false lab "pain points".
 */
import { useCallback, useEffect, useState } from "react";

type Kind = "truth" | "avoid";
type Fact = { id: string; statement: string; kind: Kind; source: string; createdAt: string };
type LF = { workspaceId: string; facts: Fact[]; updatedAt: string };

export function LabFactsEditor() {
  const [lf, setLf] = useState<LF | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<Kind>("truth");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/social/lab-facts");
      if (res.ok) setLf(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      const res = await fetch("/api/social/lab-facts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (res.ok) setLf(await res.json());
    } finally {
      setBusy(null);
    }
  }, []);

  const saveText = useCallback(
    (fact: Fact) => {
      const next = draft[fact.id];
      if (next === undefined || next === fact.statement) return;
      patch(fact.id, { statement: next });
    },
    [draft, patch],
  );

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/social/lab-facts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) setLf(await res.json());
    } finally {
      setBusy(null);
    }
  }, []);

  const add = useCallback(async () => {
    if (!newText.trim()) return;
    setBusy("new");
    try {
      const res = await fetch("/api/social/lab-facts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement: newText.trim(), kind: newKind, source: "manual" }),
      });
      if (res.ok) {
        setLf(await res.json());
        setNewText("");
      }
    } finally {
      setBusy(null);
    }
  }, [newText, newKind]);

  if (loading) return <div className="gi-loading">Loading lab facts…</div>;
  if (!lf) return <div className="gi-loading">Could not load lab facts.</div>;

  const truths = lf.facts.filter((f) => f.kind === "truth");
  const avoid = lf.facts.filter((f) => f.kind === "avoid");

  const row = (f: Fact) => {
    const value = draft[f.id] ?? f.statement;
    const dirty = value !== f.statement;
    return (
      <div key={f.id} className="gi-row">
        <textarea
          className="gi-text"
          rows={2}
          value={value}
          disabled={busy === f.id}
          onChange={(e) => setDraft((d) => ({ ...d, [f.id]: e.target.value }))}
          onBlur={() => saveText(f)}
        />
        <div className="gi-row-actions">
          <button
            className="btn ghost small"
            disabled={busy === f.id}
            onClick={() => patch(f.id, { kind: f.kind === "truth" ? "avoid" : "truth" })}
            title="Flip between a truth to respect and a misconception to avoid"
          >
            Move to {f.kind === "truth" ? "“avoid”" : "“truth”"}
          </button>
          {dirty && <button className="btn small" disabled={busy === f.id} onClick={() => saveText(f)}>Save</button>}
          <button className="btn ghost small danger" disabled={busy === f.id} onClick={() => remove(f.id)}>Delete</button>
        </div>
      </div>
    );
  };

  return (
    <div className="gi">
      <div className="gi-head">
        <div>
          <h2>Real-world lab facts</h2>
          <p className="gi-sub">
            Ground truth about how actual labs work, used so the Studio stops inventing false pain points. These grow
            when you correct a post in Training, and you can edit them here.
          </p>
        </div>
      </div>

      <div className="lf-group">
        <div className="lf-group-h ok">Truths to respect ({truths.length})</div>
        <div className="gi-list">
          {truths.length ? truths.map(row) : <p className="hist-empty">None yet.</p>}
        </div>
      </div>

      <div className="lf-group">
        <div className="lf-group-h bad">Misconceptions to avoid ({avoid.length})</div>
        <div className="gi-list">
          {avoid.length ? avoid.map(row) : <p className="hist-empty">None yet.</p>}
        </div>
      </div>

      <div className="gi-add">
        <div className="gi-add-h">Add a fact</div>
        <div className="gi-add-row">
          <select className="gi-input gi-select" value={newKind} onChange={(e) => setNewKind(e.target.value as Kind)}>
            <option value="truth">truth (respect this)</option>
            <option value="avoid">avoid (never state this)</option>
          </select>
        </div>
        <textarea
          className="gi-text"
          rows={2}
          placeholder='e.g. "Results are entered manually or fetched directly from instruments; email is not part of the results path."'
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button className="btn" disabled={busy === "new" || !newText.trim()} onClick={add}>Add fact</button>
      </div>
    </div>
  );
}
