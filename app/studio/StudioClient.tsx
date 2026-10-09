"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SlotStatus = "idea" | "drafting" | "drafted" | "edited" | "ready";
type Slot = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  index: number;
  theme: string;
  angle: string;
  status: SlotStatus;
  body: string;
  hashtags: string[];
  citationMarkers: number[];
};
type Citation = { marker: number; itemId: string; title: string; entityType: string };
type StyleRule = { id: string; rule: string; source: string; createdAt: string };

const STATUS_META: Record<SlotStatus, { label: string; color: string }> = {
  idea: { label: "Idea", color: "var(--faint)" },
  drafting: { label: "Drafting…", color: "var(--warn)" },
  drafted: { label: "Drafted", color: "var(--cool)" },
  edited: { label: "Edited", color: "var(--cool)" },
  ready: { label: "Ready", color: "var(--ok)" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayISO() {
  return fmtLocal(new Date());
}
function addDaysISO(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return fmtLocal(d);
}
function parse(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate(), dow: (d.getDay() + 6) % 7 };
}
function weekKey(iso: string) {
  // Monday-based week start, used to group/scope "this week".
  const { dow } = parse(iso);
  return addDaysISO(iso, -dow);
}

export function StudioClient() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [brief, setBrief] = useState("Educational tone, broad lab audience, concise.");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(addDaysISO(todayISO(), 20));
  const [perDay, setPerDay] = useState(1);
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [length, setLength] = useState<"short" | "standard">("short");

  const [planning, setPlanning] = useState(false);
  const [draftingWeek, setDraftingWeek] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [styleRules, setStyleRules] = useState<StyleRule[]>([]);
  const [styleOpen, setStyleOpen] = useState(false);

  const hasPlan = slots.length > 0;
  const open = slots.find((s) => s.id === openId) ?? null;

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 3200);
  };

  const loadStyle = useCallback(async () => {
    const res = await fetch("/api/social/style");
    if (res.ok) {
      const g = await res.json();
      setStyleRules(g.rules ?? []);
    }
  }, []);

  // Load persisted calendar + style guide on mount.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    loadStyle();
    (async () => {
      try {
        const res = await fetch("/api/social/calendar");
        if (res.ok) {
          const cal = await res.json();
          if (Array.isArray(cal.slots) && cal.slots.length) setSlots(cal.slots);
          if (Array.isArray(cal.citations)) setCitations(cal.citations);
          if (typeof cal.brief === "string" && cal.brief) setBrief(cal.brief);
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, [loadStyle]);

  // Auto-save the calendar whenever it changes (debounced), once initial load is done.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      fetch("/api/social/calendar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slots, citations, brief }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [slots, citations, brief, loaded]);

  async function removeRule(id: string) {
    const res = await fetch(`/api/social/style?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      const g = await res.json();
      setStyleRules(g.rules ?? []);
    }
  }

  async function addRule(rule: string) {
    const res = await fetch("/api/social/style", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule }),
    });
    if (res.ok) {
      const g = await res.json();
      setStyleRules(g.rules ?? []);
    }
  }

  const patch = useCallback((id: string, p: Partial<Slot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }, []);

  async function plan() {
    setPlanning(true);
    try {
      const existing = slots.filter((s) => s.theme).map((s) => ({ theme: s.theme, angle: s.angle }));
      const res = await fetch("/api/social/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, startDate, endDate, postsPerDay: perDay, weekdaysOnly, existing }),
      });
      const data = await res.json();
      if (!res.ok) return flash(data.error ?? "Plan failed");
      if (data.insufficient) return flash("No grounded knowledge yet — ingest material first.");
      // Merge: keep existing slots (and any drafted bodies), add/replace the newly planned range by id.
      setSlots((prev) => {
        const byId = new Map(prev.map((s) => [s.id, s]));
        for (const s of data.slots as Slot[]) {
          const existing = byId.get(s.id);
          // Preserve a drafted body if we already had one for this slot.
          byId.set(s.id, existing && existing.body ? { ...s, ...existing } : s);
        }
        return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
      });
      setCitations((c) => mergeCitations(c, data.citations ?? []));
      flash(data.note ?? "Calendar planned.");
    } finally {
      setPlanning(false);
    }
  }

  async function draftWeek(wk: string) {
    const targets = slots.filter((s) => weekKey(s.date) === wk && s.theme);
    if (targets.length === 0) return flash("Nothing to draft in this week.");
    setDraftingWeek(wk);
    const targetIds = new Set(targets.map((s) => s.id));
    const existingBodies = slots.filter((s) => s.body && !targetIds.has(s.id)).map((s) => s.body);
    setSlots((prev) => prev.map((s) => (weekKey(s.date) === wk && s.theme ? { ...s, status: "drafting" } : s)));
    try {
      const res = await fetch("/api/social/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slots: targets.map((s) => ({ id: s.id, date: s.date, index: s.index, theme: s.theme, angle: s.angle })),
          brief,
          length,
          existingBodies,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.insufficient) {
        setSlots((prev) => prev.map((s) => (weekKey(s.date) === wk ? { ...s, status: s.body ? s.status : "idea" } : s)));
        return flash(data.error ?? "Draft failed");
      }
      const byId = new Map<string, { body: string; hashtags: string[]; citationMarkers: number[] }>(
        (data.drafts ?? []).map((d: { id: string; body: string; hashtags: string[]; citationMarkers: number[] }) => [d.id, d]),
      );
      setSlots((prev) =>
        prev.map((s) => {
          const d = byId.get(s.id);
          return d ? { ...s, body: d.body, hashtags: d.hashtags, citationMarkers: d.citationMarkers, status: "drafted" } : s;
        }),
      );
      setCitations((c) => mergeCitations(c, data.citations ?? []));
      const notes = Array.isArray(data.dedupeNotes) ? data.dedupeNotes.length : 0;
      flash(`Drafted ${byId.size} post${byId.size === 1 ? "" : "s"}${notes ? ` · ${notes} de-duplicated` : ""}.`);
    } finally {
      setDraftingWeek(null);
    }
  }

  function reset() {
    setSlots([]);
    setCitations([]);
    setOpenId(null);
    fetch("/api/social/calendar", { method: "DELETE" }).catch(() => {});
  }

  // Group slots by ISO week for the "draft this week" affordance + month layout.
  const weeks = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = weekKey(s.date);
      (map.get(k) ?? map.set(k, []).get(k)!).push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  const counts = useMemo(() => {
    const c = { total: slots.length, ready: 0, drafted: 0, idea: 0 };
    for (const s of slots) {
      if (s.status === "ready") c.ready++;
      else if (s.status === "drafted" || s.status === "edited") c.drafted++;
      else c.idea++;
    }
    return c;
  }, [slots]);

  return (
    <div className="studio">
      <header className="studio-head">
        <div>
          <h1>Content Studio</h1>
          <p className="lead">A grounded LinkedIn calendar for Sampleify — plan the month, draft by the week, polish each post.</p>
        </div>
        <div className="head-stats">
          {hasPlan && (
            <>
              <Stat n={counts.total} label="slots" />
              <Stat n={counts.idea} label="ideas" tone="faint" />
              <Stat n={counts.drafted} label="drafted" tone="cool" />
              <Stat n={counts.ready} label="ready" tone="ok" />
            </>
          )}
          <button className="btn ghost small" onClick={() => setStyleOpen(true)}>
            Style memory{styleRules.length ? ` · ${styleRules.length}` : ""}
          </button>
          {hasPlan && <button className="btn ghost small" onClick={reset}>Reset</button>}
        </div>
      </header>

      {!hasPlan ? (
        <SetupPanel
          brief={brief} setBrief={setBrief}
          startDate={startDate} setStartDate={setStartDate}
          endDate={endDate} setEndDate={setEndDate}
          perDay={perDay} setPerDay={setPerDay}
          weekdaysOnly={weekdaysOnly} setWeekdaysOnly={setWeekdaysOnly}
          planning={planning} onPlan={plan}
        />
      ) : (
        <div className="calendar">
          {weeks.map(([wk, wkSlots], wi) => {
            const anyDraftable = wkSlots.some((s) => s.theme);
            const label = weekLabel(wk, wkSlots);
            const busy = draftingWeek === wk;
            return (
              <section key={wk} className="week" style={{ animationDelay: `${wi * 40}ms` }}>
                <div className="week-head">
                  <span className="week-label">{label}</span>
                  <button
                    className="btn small"
                    disabled={!anyDraftable || busy}
                    onClick={() => draftWeek(wk)}
                  >
                    {busy ? "Drafting…" : "Draft this week"}
                  </button>
                </div>
                <div className="days">
                  {wkSlots
                    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)
                    .map((s) => (
                      <SlotCard key={s.id} slot={s} onOpen={() => setOpenId(s.id)} />
                    ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {open && (
        <Composer
          slot={open}
          citations={citations}
          length={length}
          existingBodies={slots.filter((s) => s.body && s.id !== open.id).map((s) => s.body)}
          onClose={() => setOpenId(null)}
          onPatch={patch}
          onFlash={flash}
          onMergeCitations={(c) => setCitations((prev) => mergeCitations(prev, c))}
          onLearned={() => loadStyle()}
        />
      )}

      {styleOpen && (
        <StylePanel
          rules={styleRules}
          onClose={() => setStyleOpen(false)}
          onRemove={removeRule}
          onAdd={addRule}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function StylePanel({
  rules, onClose, onRemove, onAdd,
}: {
  rules: StyleRule[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onAdd: (rule: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="style-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Learned preferences</div>
            <h2 className="drawer-theme">Style memory</h2>
            <div className="drawer-angle">
              What the Studio has learned from your revisions. These apply to every draft and revision going forward.
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="style-body">
          {rules.length === 0 ? (
            <div className="editor-empty">
              Nothing learned yet. Revise a post with an instruction like &quot;lead with the problem&quot; or &quot;no exclamation points&quot; and the Studio will remember it for all future posts.
            </div>
          ) : (
            <ul className="rule-list">
              {rules.map((r) => (
                <li key={r.id} className="rule">
                  <div className="rule-main">
                    <div className="rule-text">{r.rule}</div>
                    {r.source && r.source !== "manual" && <div className="rule-src">from: “{r.source}”</div>}
                  </div>
                  <button className="icon-btn tiny" onClick={() => onRemove(r.id)} aria-label="Remove">✕</button>
                </li>
              ))}
            </ul>
          )}
          <div className="rule-add">
            <input
              value={draft}
              placeholder="Add a rule manually — e.g. “Always end with a question”"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { onAdd(draft.trim()); setDraft(""); } }}
            />
            <button className="btn small" disabled={!draft.trim()} onClick={() => { onAdd(draft.trim()); setDraft(""); }}>
              Add rule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "ok" | "cool" | "faint" }) {
  return (
    <div className="stat">
      <span className="stat-n" style={{ color: tone ? `var(--${tone === "faint" ? "faint" : tone})` : "var(--text)" }}>{n}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

function SetupPanel(p: {
  brief: string; setBrief: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void;
  endDate: string; setEndDate: (v: string) => void;
  perDay: number; setPerDay: (v: number) => void;
  weekdaysOnly: boolean; setWeekdaysOnly: (v: boolean) => void;
  planning: boolean; onPlan: () => void;
}) {
  return (
    <div className="setup">
      <div className="setup-card">
        <div className="eyebrow">New calendar</div>
        <label className="field">
          <span>Brief — tone, audience, angle</span>
          <textarea rows={2} value={p.brief} onChange={(e) => p.setBrief(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>From</span>
            <input type="date" value={p.startDate} onChange={(e) => p.setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={p.endDate} onChange={(e) => p.setEndDate(e.target.value)} />
          </label>
          <label className="field narrow">
            <span>Posts / day</span>
            <select value={p.perDay} onChange={(e) => p.setPerDay(Number(e.target.value))}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={p.weekdaysOnly} onChange={(e) => p.setWeekdaysOnly(e.target.checked)} />
          Weekdays only
        </label>
        <button className="btn big" disabled={p.planning} onClick={p.onPlan}>
          {p.planning ? "Planning the calendar…" : "Plan the calendar →"}
        </button>
        <p className="setup-note">
          I&apos;ll assign a grounded theme to each day from what the Brain knows. Then draft week by week, and polish any post with a live preview.
        </p>
      </div>
    </div>
  );
}

function SlotCard({ slot, onOpen }: { slot: Slot; onOpen: () => void }) {
  const { day, dow } = parse(slot.date);
  const sm = STATUS_META[slot.status];
  return (
    <button className={`slot ${slot.status}`} onClick={onOpen}>
      <div className="slot-date">
        <span className="slot-dow">{DOW[dow]}</span>
        <span className="slot-day">{day}</span>
        {slot.index > 1 && <span className="slot-ix">#{slot.index}</span>}
      </div>
      <div className="slot-body">
        <div className="slot-theme">{slot.theme || "Unplanned"}</div>
        {slot.body ? (
          <div className="slot-preview">{slot.body.split("\n")[0]}</div>
        ) : (
          <div className="slot-angle">{slot.angle}</div>
        )}
      </div>
      <span className="slot-dot" style={{ background: sm.color }} title={sm.label} />
    </button>
  );
}

function Composer(props: {
  slot: Slot;
  citations: Citation[];
  length: "short" | "standard";
  existingBodies: string[];
  onClose: () => void;
  onPatch: (id: string, p: Partial<Slot>) => void;
  onFlash: (m: string) => void;
  onMergeCitations: (c: Citation[]) => void;
  onLearned: (rule: string) => void;
}) {
  const { slot, onClose, onPatch, onFlash } = props;
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  const [drafting, setDrafting] = useState(false);

  const cited = props.citations.filter((c) => slot.citationMarkers.includes(c.marker));

  async function draftThis() {
    setDrafting(true);
    onPatch(slot.id, { status: "drafting" });
    try {
      const res = await fetch("/api/social/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slots: [{ id: slot.id, date: slot.date, index: slot.index, theme: slot.theme, angle: slot.angle }],
          brief: slot.angle,
          length: props.length,
          existingBodies: props.existingBodies,
        }),
      });
      const data = await res.json();
      const d = (data.drafts ?? [])[0];
      if (d) {
        onPatch(slot.id, { body: d.body, hashtags: d.hashtags, citationMarkers: d.citationMarkers, status: "drafted" });
        props.onMergeCitations(data.citations ?? []);
      } else {
        onPatch(slot.id, { status: slot.body ? "drafted" : "idea" });
        onFlash(data.error ?? "Couldn't draft this post.");
      }
    } finally {
      setDrafting(false);
    }
  }

  async function revise() {
    if (!instruction.trim()) return;
    setRevising(true);
    try {
      const res = await fetch("/api/social/revise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slot: { id: slot.id, date: slot.date, theme: slot.theme, angle: slot.angle, body: slot.body, hashtags: slot.hashtags },
          instruction,
        }),
      });
      const data = await res.json();
      if (res.ok && data.body) {
        onPatch(slot.id, { body: data.body, hashtags: data.hashtags, citationMarkers: data.citationMarkers, status: "edited" });
        props.onMergeCitations(data.citations ?? []);
        setInstruction("");
        if (data.learnedRule) {
          props.onLearned(data.learnedRule);
          onFlash(`Learned: "${data.learnedRule}" — applied to all future posts.`);
        }
      } else {
        onFlash(data.error ?? "Revision failed.");
      }
    } finally {
      setRevising(false);
    }
  }

  async function copy() {
    const text = slot.hashtags.length
      ? `${slot.body}\n\n${slot.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`
      : slot.body;
    await navigator.clipboard.writeText(text);
    onFlash("Copied to clipboard.");
  }

  const { day, m, y } = parse(slot.date);
  const dateLabel = `${DOW[parse(slot.date).dow]}, ${MONTHS[m]} ${day} ${y}`;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-date">{dateLabel}</div>
            <h2 className="drawer-theme">{slot.theme || "Unplanned"}</h2>
            <div className="drawer-angle">{slot.angle}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          {/* Editor side */}
          <div className="editor-col">
            <div className="col-label">
              <span className="eyebrow">Copy</span>
              {!slot.body && (
                <button className="btn small" disabled={drafting} onClick={draftThis}>
                  {drafting ? "Drafting…" : "Draft with AI"}
                </button>
              )}
            </div>

            {slot.body ? (
              <>
                <textarea
                  className="editor"
                  value={slot.body}
                  onChange={(e) => onPatch(slot.id, { body: e.target.value, status: "edited" })}
                  rows={12}
                />
                <input
                  className="tags-input"
                  value={slot.hashtags.join(" ")}
                  placeholder="hashtags (space-separated)"
                  onChange={(e) => onPatch(slot.id, { hashtags: e.target.value.split(/\s+/).filter(Boolean) })}
                />
                <div className="revise">
                  <input
                    value={instruction}
                    placeholder='Tell AI how to change it — "shorter hook", "lead with the metric"…'
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") revise(); }}
                  />
                  <button className="btn small" disabled={revising || !instruction.trim()} onClick={revise}>
                    {revising ? "Revising…" : "Revise"}
                  </button>
                </div>
              </>
            ) : (
              <div className="editor-empty">
                No copy yet. Draft this post with AI, grounded in the Brain — or draft the whole week from the calendar.
              </div>
            )}
          </div>

          {/* Preview side */}
          <div className="preview-col">
            <span className="eyebrow">LinkedIn preview</span>
            <LinkedInPreview body={slot.body} hashtags={slot.hashtags} />
            {slot.body && (
              <div className="grounded">
                {cited.length > 0 ? (
                  <>
                    <span className="badge ok">Grounded</span>
                    {cited.map((c) => (
                      <Link key={c.itemId} href={`/item/${c.itemId}`} target="_blank" className="cite">{c.title}</Link>
                    ))}
                  </>
                ) : (
                  <span className="badge">No citations attached</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="drawer-foot">
          <div className="foot-left">
            {slot.body && (
              <label className="ready-toggle">
                <input
                  type="checkbox"
                  checked={slot.status === "ready"}
                  onChange={(e) => onPatch(slot.id, { status: e.target.checked ? "ready" : "edited" })}
                />
                Mark ready to post
              </label>
            )}
          </div>
          <div className="foot-right">
            {slot.body && <button className="btn" onClick={copy}>Copy for LinkedIn</button>}
            <button className="btn ghost" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkedInPreview({ body, hashtags }: { body: string; hashtags: string[] }) {
  const full = hashtags.length
    ? `${body}\n\n${hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`
    : body;
  const [expanded, setExpanded] = useState(false);
  const limit = 240;
  const needsTruncation = full.length > limit && !expanded;
  const shown = needsTruncation ? full.slice(0, limit) : full;

  return (
    <div className="li-card">
      <div className="li-top">
        <div className="li-avatar">S</div>
        <div className="li-id">
          <div className="li-name">Sampleify</div>
          <div className="li-sub">Laboratory Information Management · Promoted</div>
          <div className="li-sub">Just now · 🌐</div>
        </div>
        <span className="li-more">···</span>
      </div>
      <div className="li-body">
        {shown ? shown : <span className="li-placeholder">Your post preview appears here.</span>}
        {needsTruncation && (
          <>
            …<button className="li-see" onClick={() => setExpanded(true)}>see more</button>
          </>
        )}
      </div>
      <div className="li-actions">
        <span>👍 Like</span><span>💬 Comment</span><span>↻ Repost</span><span>➤ Send</span>
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────
function mergeCitations(prev: Citation[], next: Citation[]): Citation[] {
  const map = new Map(prev.map((c) => [c.marker, c]));
  for (const c of next) map.set(c.marker, c);
  return [...map.values()].sort((a, b) => a.marker - b.marker);
}
function weekLabel(_wk: string, slots: Slot[]): string {
  const dates = [...new Set(slots.map((s) => s.date))].sort();
  const a = parse(dates[0]);
  const b = parse(dates[dates.length - 1]);
  if (dates.length === 1 || (a.m === b.m && a.day === b.day)) return `${MONTHS[a.m]} ${a.day}`;
  if (a.m === b.m) return `${MONTHS[a.m]} ${a.day}–${b.day}`;
  return `${MONTHS[a.m]} ${a.day} – ${MONTHS[b.m]} ${b.day}`;
}

