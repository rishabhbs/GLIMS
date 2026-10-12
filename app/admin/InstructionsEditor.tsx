"use client";

/**
 * Global Instructions editor — the base writing policy, visible and editable.
 *
 * This is the surface the user asked for: "show me the system prompt somewhere
 * so I can update it." These rules are the base policy for every generated post
 * (training + calendar). Learned feedback that contradicts one of these is not
 * applied silently; the user is asked whether to override for one post or edit
 * the rule here.
 */
import { useCallback, useEffect, useState } from "react";

type Category = "identity" | "grounding" | "voice" | "format" | "structure";
type Instruction = {
  id: string;
  title: string;
  text: string;
  category: Category;
  enabled: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
};
type GI = { workspaceId: string; instructions: Instruction[]; updatedAt: string };

const CATEGORIES: Category[] = ["identity", "grounding", "voice", "format", "structure"];

export function InstructionsEditor() {
  const [gi, setGi] = useState<GI | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [newCat, setNewCat] = useState<Category>("voice");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/social/instructions");
      if (res.ok) setGi(await res.json());
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
      const res = await fetch("/api/social/instructions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (res.ok) setGi(await res.json());
    } finally {
      setBusy(null);
    }
  }, []);

  const saveText = useCallback(
    (inst: Instruction) => {
      const next = draft[inst.id];
      if (next === undefined || next === inst.text) return;
      patch(inst.id, { text: next });
    },
    [draft, patch],
  );

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/social/instructions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) setGi(await res.json());
    } finally {
      setBusy(null);
    }
  }, []);

  const add = useCallback(async () => {
    if (!newText.trim()) return;
    setBusy("new");
    try {
      const res = await fetch("/api/social/instructions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() || "New rule", text: newText.trim(), category: newCat }),
      });
      if (res.ok) {
        setGi(await res.json());
        setNewTitle("");
        setNewText("");
      }
    } finally {
      setBusy(null);
    }
  }, [newTitle, newText, newCat]);

  const reset = useCallback(async () => {
    if (!confirm("Restore the default base policy? Your edits and custom rules will be replaced.")) return;
    setBusy("reset");
    try {
      const res = await fetch("/api/social/instructions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (res.ok) {
        setGi(await res.json());
        setDraft({});
      }
    } finally {
      setBusy(null);
    }
  }, []);

  if (loading) return <div className="gi-loading">Loading global instructions…</div>;
  if (!gi) return <div className="gi-loading">Could not load instructions.</div>;

  return (
    <div className="gi">
      <div className="gi-head">
        <div>
          <h2>Global writing instructions</h2>
          <p className="gi-sub">
            The base policy applied to every generated post. Edit these to change how the Studio writes everywhere.
            When your feedback contradicts a rule, the Studio asks before changing it.
          </p>
        </div>
        <button className="btn ghost small" disabled={busy === "reset"} onClick={reset}>
          Restore defaults
        </button>
      </div>

      <div className="gi-list">
        {gi.instructions.map((inst) => {
          const value = draft[inst.id] ?? inst.text;
          const dirty = value !== inst.text;
          return (
            <div key={inst.id} className={`gi-row ${inst.enabled ? "" : "off"}`}>
              <div className="gi-row-top">
                <span className={`gi-cat gi-cat-${inst.category}`}>{inst.category}</span>
                <span className="gi-title">{inst.title}</span>
                {inst.locked && <span className="gi-lock" title="Guardrail — can be edited or disabled, not deleted">guardrail</span>}
                <label className="gi-toggle">
                  <input
                    type="checkbox"
                    checked={inst.enabled}
                    disabled={busy === inst.id}
                    onChange={(e) => patch(inst.id, { enabled: e.target.checked })}
                  />
                  <span>{inst.enabled ? "on" : "off"}</span>
                </label>
              </div>
              <textarea
                className="gi-text"
                rows={3}
                value={value}
                disabled={busy === inst.id}
                onChange={(e) => setDraft((d) => ({ ...d, [inst.id]: e.target.value }))}
                onBlur={() => saveText(inst)}
              />
              <div className="gi-row-actions">
                {dirty && (
                  <button className="btn small" disabled={busy === inst.id} onClick={() => saveText(inst)}>
                    Save
                  </button>
                )}
                {!inst.locked && (
                  <button className="btn ghost small danger" disabled={busy === inst.id} onClick={() => remove(inst.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="gi-add">
        <div className="gi-add-h">Add a rule</div>
        <div className="gi-add-row">
          <input
            className="gi-input"
            placeholder="Short title (e.g. Lead with a number)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <select className="gi-input gi-select" value={newCat} onChange={(e) => setNewCat(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="gi-text"
          rows={2}
          placeholder="The instruction text injected into every prompt…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button className="btn" disabled={busy === "new" || !newText.trim()} onClick={add}>
          Add rule
        </button>
      </div>
    </div>
  );
}
