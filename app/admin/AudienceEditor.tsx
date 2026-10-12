"use client";

/**
 * Audience editor — who the Studio writes for.
 *
 * Corrects persona assumptions (e.g. "in small labs, senior analysts also run
 * tests"). Grows when you correct a post classified as an audience correction,
 * and is editable here. Injected into every generation as grounding.
 */
import { useCallback, useEffect, useState } from "react";

type Note = { id: string; statement: string; source: string; createdAt: string };
type AM = { workspaceId: string; notes: Note[]; updatedAt: string };

export function AudienceEditor() {
  const [am, setAm] = useState<AM | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newText, setNewText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/social/audience");
      if (res.ok) setAm(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveText = useCallback(
    async (note: Note) => {
      const next = draft[note.id];
      if (next === undefined || next === note.statement || !next.trim()) return;
      setBusy(note.id);
      try {
        const res = await fetch("/api/social/audience", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: note.id, statement: next }),
        });
        if (res.ok) setAm(await res.json());
      } finally {
        setBusy(null);
      }
    },
    [draft],
  );

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/social/audience?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) setAm(await res.json());
    } finally {
      setBusy(null);
    }
  }, []);

  const add = useCallback(async () => {
    if (!newText.trim()) return;
    setBusy("new");
    try {
      const res = await fetch("/api/social/audience", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement: newText.trim() }),
      });
      if (res.ok) {
        setAm(await res.json());
        setNewText("");
      }
    } finally {
      setBusy(null);
    }
  }, [newText]);

  if (loading) return <div className="gi-loading">Loading audience model…</div>;
  if (!am) return <div className="gi-loading">Could not load audience model.</div>;

  return (
    <div className="gi">
      <div className="gi-head">
        <div>
          <h2>Audience understanding</h2>
          <p className="gi-sub">
            Who the Studio writes for. Corrects persona assumptions (e.g. &ldquo;in small labs everyone does
            everything&rdquo;). Grows from audience corrections in Training; editable here.
          </p>
        </div>
      </div>

      <div className="gi-list">
        {am.notes.length ? (
          am.notes.map((n) => {
            const value = draft[n.id] ?? n.statement;
            const dirty = value !== n.statement;
            return (
              <div key={n.id} className="gi-row">
                <textarea
                  className="gi-text"
                  rows={2}
                  value={value}
                  disabled={busy === n.id}
                  onChange={(e) => setDraft((d) => ({ ...d, [n.id]: e.target.value }))}
                  onBlur={() => saveText(n)}
                />
                <div className="gi-row-actions">
                  {dirty && <button className="btn small" disabled={busy === n.id} onClick={() => saveText(n)}>Save</button>}
                  <button className="btn ghost small danger" disabled={busy === n.id} onClick={() => remove(n.id)}>Delete</button>
                </div>
              </div>
            );
          })
        ) : (
          <p className="hist-empty">None yet.</p>
        )}
      </div>

      <div className="gi-add">
        <div className="gi-add-h">Add an audience note</div>
        <textarea
          className="gi-text"
          rows={2}
          placeholder='e.g. "In small labs, senior analysts also run tests themselves, not just review."'
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button className="btn" disabled={busy === "new" || !newText.trim()} onClick={add}>Add note</button>
      </div>
    </div>
  );
}
