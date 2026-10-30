"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { messages, type Lang, type Messages } from "@/i18n/messages";
import { getJson, NetworkError, newId, postJson } from "@/client/api";
import { errorText } from "@/components/entry/entry-form";
import { mfield, mlabel } from "@/components/manage-ui";
import { CLIENT_FIELDS, ITEM_FIELDS, cellText, readLayout, mapHeadings, toRecords, type Field, type ImportKind, type Mapping, type Row, type SheetLayout } from "@/import/columns";
import type { Decision, Decisions, Plan, PlanRow, Status } from "@/import/plan";
import { formatQty } from "@/lib/qty";

const MAX_FILE = 10 * 1024 * 1024;
const MAX_ROWS = 2000;
const PAGE = 60;

interface Sheet {
  name: string;
  rows: string[][];
}

type XLSXModule = typeof import("xlsx");
const loadXlsx = () => import("xlsx") as Promise<XLSXModule>;

/** Every sheet as text cells. Rows keep their Excel numbers (a sheet that starts at row 3 gets two empty rows first). */
async function readFile(file: File): Promise<Sheet[]> {
  const XLSX = await loadXlsx();
  const isText = /\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith("text/");
  // Text files are read as UTF-8 so Hindi names survive; Excel files as bytes.
  const wb = isText ? XLSX.read(await file.text(), { type: "string", raw: false }) : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) return { name, rows: [] };
    const start = XLSX.utils.decode_range(ws["!ref"]).s.r;
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: true });
    return { name, rows: [...Array.from({ length: start }, () => [] as string[]), ...data.map((r) => (r as unknown[]).map(cellText))] };
  });
}

/** A sheet as an .xlsx download. */
async function download(name: string, rows: string[][]) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = (rows[0] ?? []).map((_, c) => ({ wch: Math.min(40, Math.max(10, ...rows.slice(0, 200).map((r) => (r[c] ?? "").length + 2))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  XLSX.writeFile(wb, `${name}.xlsx`);
}

const signed = (c: number) => (c < 0 ? `−${formatQty(-c)}` : formatQty(c));

const colName = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function DownloadCard({ t }: { t: Messages }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function get(kind: "clients" | "items", blank: boolean) {
    setBusy(`${kind}${blank}`);
    setErr(null);
    try {
      const r = await getJson<{ rows: string[][] }>(`/api/import?kind=${kind}`);
      if (!r.ok) return setErr(errorText(t, r.code));
      await download(`godown-${kind}${blank ? "-template" : ""}`, blank ? r.rows.slice(0, 1) : r.rows);
    } catch (e) {
      setErr(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
    } finally {
      setBusy(null);
    }
  }
  const btn = "rounded-control border-2 border-line-strong px-3 py-2.5 text-left font-semibold active:bg-sunken disabled:opacity-40";
  return (
    <details className="rounded-card bg-surface p-4 shadow-card">
      <summary className="cursor-pointer text-lg font-semibold">⬇️ {t.imp.downloadTitle}</summary>
      <p className="mt-2 text-sm text-ink-subtle">{t.imp.downloadHint}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button disabled={!!busy} onClick={() => get("clients", false)} className={btn}>
          👥 {t.m.clients}
        </button>
        <button disabled={!!busy} onClick={() => get("items", false)} className={btn}>
          📦 {t.imp.itemsStock}
        </button>
        <button disabled={!!busy} onClick={() => get("clients", true)} className={`${btn} text-sm font-normal`}>
          {t.imp.blank} · {t.m.clients}
        </button>
        <button disabled={!!busy} onClick={() => get("items", true)} className={`${btn} text-sm font-normal`}>
          {t.imp.blank} · {t.imp.itemsStock}
        </button>
      </div>
      {err && <p className="mt-2 rounded-control bg-danger-soft p-3 text-danger">{err}</p>}
    </details>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  new: "bg-go-soft text-go-strong",
  update: "bg-brand-soft text-brand-strong",
  same: "bg-sunken text-ink-muted",
  choose: "bg-status-pending-bg text-status-pending",
  skip: "bg-sunken text-ink-subtle",
  error: "bg-danger-soft text-danger",
};

function noteText(t: Messages, n: { code: string; detail?: string }) {
  const base = t.imp.notes[n.code] ?? n.code;
  return n.detail ? `${base}: ${n.detail}` : base;
}

function PlanCard({
  t,
  kind,
  row,
  decision,
  onDecide,
}: {
  t: Messages;
  kind: ImportKind;
  row: PlanRow;
  decision?: Decision;
  onDecide: (d: Decision | null) => void;
}) {
  const rowsText = `${t.imp.row} ${row.rows.join(", ")}`;
  const canChoose = row.status !== "error";
  const showChoices = row.status === "choose" || (decision && decision.action !== "skip") || (row.candidates.length > 0 && row.status === "new");
  const fieldLabel = (f: string) => t.imp.fields[f] ?? f;
  return (
    <div className={`space-y-2 rounded-card bg-surface p-4 shadow-card ${row.status === "choose" ? "ring-2 ring-amber-300" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-lg font-semibold">{row.name}</p>
          <p className="text-sm text-ink-subtle">
            {rowsText}
            {row.targetName && row.targetName !== row.name && ` · → ${row.targetName}`}
            {row.matchedBy && ` · ${t.imp.matchedBy[row.matchedBy] ?? row.matchedBy}`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[row.status]}`}>{t.imp.status[row.status]}</span>
      </div>
      {row.error && <p className="text-sm text-danger">{t.imp.errors[row.error] ?? row.error}</p>}
      {row.changes.length > 0 && (
        <ul className="space-y-0.5 text-sm">
          {row.changes.map((c, i) => (
            <li key={i}>
              <span className="text-ink-subtle">{fieldLabel(c.field)}:</span> {c.from ? <s className="text-ink-subtle">{c.from}</s> : null} {c.from ? "→ " : ""}
              <b>{c.field === "show" ? t.imp.showAgain : c.to}</b>
            </li>
          ))}
        </ul>
      )}
      {row.stock && (
        <p className="text-sm">
          📦{" "}
          {row.stock.before !== null && <>{signed(row.stock.before)} → </>}
          <b>{signed(row.stock.after)}</b>{" "}
          {row.stock.unit}
        </p>
      )}
      {row.notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-status-pending">
          {row.notes.map((n, i) => (
            <li key={i}>• {noteText(t, n)}</li>
          ))}
        </ul>
      )}
      {canChoose && showChoices && (
        <div className="space-y-1.5 rounded-control bg-sunken p-2">
          <p className="px-1 text-sm font-medium text-ink-muted">{row.status === "choose" ? t.imp.sameAs : t.imp.maybeSameAs}</p>
          {row.candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-2 has-[:checked]:bg-surface">
              <input type="radio" name={`d${row.rows[0]}`} checked={decision?.action === "match" && decision.id === c.id} onChange={() => onDecide({ action: "match", id: c.id })} className="size-5" />
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-ink-subtle">{Math.round(c.score * 100)}%</span>
            </label>
          ))}
          <label className="flex items-center gap-3 rounded-lg px-2 py-2 has-[:checked]:bg-surface">
            <input type="radio" name={`d${row.rows[0]}`} checked={decision?.action === "new"} onChange={() => onDecide({ action: "new" })} className="size-5" />
            <span className="flex-1">{kind === "clients" ? t.imp.newClient : t.imp.newItem}</span>
          </label>
        </div>
      )}
      {canChoose && (
        <div className="flex justify-end gap-3 text-sm">
          {decision && decision.action !== "skip" && (
            <button onClick={() => onDecide(null)} className="text-ink-subtle underline">
              {t.imp.undoChoice}
            </button>
          )}
          <button onClick={() => onDecide(decision?.action === "skip" ? null : { action: "skip" })} className="font-semibold text-ink-muted underline">
            {decision?.action === "skip" ? t.imp.include : t.imp.skip}
          </button>
        </div>
      )}
    </div>
  );
}

export function ImportView({ lang, today, shared }: { lang: Lang; today: string; shared: boolean }) {
  const t = messages(lang);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [layout, setLayout] = useState<SheetLayout | null>(null);
  const [stockMode, setStockMode] = useState<"set" | "add" | "none">("set");
  const [date, setDate] = useState(today);
  const [defaultUnit, setDefaultUnit] = useState("pcs");
  const [overwrite, setOverwrite] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [filter, setFilter] = useState<Status | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | { kind: ImportKind; created: number; updated: number; stockLines?: number; stockKind?: string | null; duplicate?: boolean }>(null);
  const importId = useRef(newId());
  const seq = useRef(0);

  const sheet = sheets?.[sheetIdx];
  const records: Row[] = useMemo(() => (sheet && layout ? toRecords(sheet.rows, layout) : []), [sheet, layout]);
  const fields: readonly Field[] = layout?.kind === "items" ? ITEM_FIELDS : CLIENT_FIELDS;
  const width = sheet ? Math.max(0, ...sheet.rows.slice(0, 200).map((r) => r.length)) : 0;
  const headings = sheet && layout && layout.headerRow >= 0 ? sheet.rows[layout.headerRow] : [];
  const nameField = layout?.kind === "items" ? "item" : "name";
  const mappedName = layout?.mapping[nameField] !== undefined;

  function reset() {
    setSheets(null);
    setLayout(null);
    setPlan(null);
    setDecisions({});
    setDone(null);
    setErr(null);
    setFileName("");
    importId.current = newId();
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    reset();
    if (f.size > MAX_FILE) return setErr(t.imp.tooBigFile);
    setBusy(true);
    try {
      const all = await readFile(f);
      const usable = all.filter((s) => s.rows.some((r) => r.some(Boolean)));
      if (!usable.length) return setErr(t.imp.emptyFile);
      // Start on the sheet that looks most like a list we know.
      const best = usable.map((s, i) => ({ i, score: readLayout(s.rows).headerRow >= 0 ? Object.keys(readLayout(s.rows).mapping).length : 0 })).sort((a, b) => b.score - a.score)[0].i;
      setFileName(f.name);
      setSheets(usable);
      setSheetIdx(best);
      setLayout(readLayout(usable[best].rows));
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setErr(/password|encrypt/i.test(m) ? t.imp.passwordFile : t.imp.unreadable);
    } finally {
      setBusy(false);
    }
  }

  function pickSheet(i: number) {
    setSheetIdx(i);
    setLayout(readLayout(sheets![i].rows));
    setPlan(null);
    setDecisions({});
  }

  function setKind(kind: ImportKind) {
    if (!sheet || !layout) return;
    setLayout({ ...layout, kind, mapping: layout.headerRow >= 0 ? mapHeadings(sheet.rows[layout.headerRow], kind) : {} });
    setPlan(null);
    setDecisions({});
  }

  function setHeaderRow(r: number) {
    if (!sheet || !layout) return;
    setLayout({ ...layout, headerRow: r, mapping: r >= 0 ? mapHeadings(sheet.rows[r] ?? [], layout.kind) : layout.mapping });
    setPlan(null);
  }

  function setColumn(field: Field, col: number | null) {
    if (!layout) return;
    const mapping: Mapping = { ...layout.mapping };
    // One column, one field.
    for (const [f, c] of Object.entries(mapping)) if (c === col) delete mapping[f as Field];
    if (col === null) delete mapping[field];
    else mapping[field] = col;
    setLayout({ ...layout, mapping });
    setPlan(null);
  }

  async function preview(d: Decisions = decisions) {
    if (!layout) return;
    const my = ++seq.current;
    setBusy(true);
    setErr(null);
    try {
      const r = await postJson<{ plan: Plan }>("/api/import", {
        action: "preview",
        kind: layout.kind,
        rows: records,
        decisions: d,
        options: { stockMode, date, defaultUnit, overwrite },
      });
      if (my !== seq.current) return;
      if (!r.ok) return setErr(errorText(t, r.code, r.details));
      setPlan(r.plan);
    } catch (e) {
      setErr(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }

  // A choice can change other lines (a GSTIN or name now taken): plan again after each one.
  useEffect(() => {
    if (!plan) return;
    const id = setTimeout(() => void preview(decisions), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisions]);

  function decide(rowNo: number, d: Decision | null) {
    setDecisions((cur) => {
      const next = { ...cur };
      if (d) next[rowNo] = d;
      else delete next[rowNo];
      return next;
    });
  }

  function acceptSuggestions() {
    if (!plan) return;
    const next = { ...decisions };
    for (const r of plan.rows) if (r.status === "choose" && r.candidates[0] && !next[r.rows[0]]) next[r.rows[0]] = { action: "match", id: r.candidates[0].id };
    setDecisions(next);
  }
  function allNew() {
    if (!plan) return;
    const next = { ...decisions };
    for (const r of plan.rows) if (r.status === "choose" && !next[r.rows[0]]) next[r.rows[0]] = { action: "new" };
    setDecisions(next);
  }

  async function apply() {
    if (!layout || !plan) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await postJson<{ result: { created: number; updated: number; stockLines?: number; stockKind?: string | null; duplicate?: boolean } }>("/api/import", {
        action: "apply",
        importId: importId.current,
        kind: layout.kind,
        rows: records,
        decisions,
        options: { stockMode, date, defaultUnit, overwrite },
        label: `${fileName} · ${sheet?.name ?? ""}`,
      });
      if (!r.ok) return setErr(errorText(t, r.code, r.details));
      setDone({ kind: layout.kind, ...r.result });
    } catch (e) {
      setErr(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
    } finally {
      setBusy(false);
    }
  }

  const counts = plan?.counts;
  const toSave = counts ? counts.new + counts.update : 0;
  const list = plan ? plan.rows.filter((r) => filter === "all" || r.status === filter) : [];

  if (done)
    return (
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
        <div className="space-y-2 rounded-card bg-go-soft p-5 text-go-strong">
          <p className="text-2xl font-bold">✓ {done.duplicate ? t.imp.alreadyDone : t.imp.done}</p>
          <p>
            {t.imp.created}: <b>{done.created}</b> · {t.imp.updated}: <b>{done.updated}</b>
          </p>
          {!!done.stockLines && (
            <p>
              📦 {done.stockKind === "count" ? t.imp.stockSet : t.imp.stockAdded}: <b>{done.stockLines}</b>
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link href={done.kind === "clients" ? "/manage/clients" : "/stock"} className="rounded-control bg-brand py-3 text-center font-semibold text-ink-inverse">
            {done.kind === "clients" ? t.m.clients : t.s.title}
          </Link>
          <button onClick={reset} className="rounded-control border-2 border-line-strong py-3 font-semibold">
            {t.imp.another}
          </button>
        </div>
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      {!sheets && (
        <>
          <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
            <p className="text-lg font-semibold">📊 {t.imp.pickTitle}</p>
            <p className="text-sm text-ink-muted">{t.imp.pickHint}</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <button disabled={busy} onClick={() => fileRef.current?.click()} className="w-full rounded-control bg-brand py-4 text-lg font-semibold text-ink-inverse disabled:opacity-40">
              {busy ? "…" : t.imp.chooseFile}
            </button>
            <p className="text-sm text-ink-subtle">{t.imp.formats}</p>
          </div>
          <DownloadCard t={t} />
        </>
      )}

      {err && <p className="rounded-control bg-danger-soft p-3 text-danger">{err}</p>}

      {sheets && sheet && layout && (
        <>
          <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 break-words font-semibold">📄 {fileName}</p>
              <button onClick={reset} className="shrink-0 text-sm text-ink-subtle underline">
                {t.imp.changeFile}
              </button>
            </div>
            {sheets.length > 1 && (
              <label className="block space-y-1.5">
                <span className={mlabel}>{t.imp.sheet}</span>
                <select value={sheetIdx} onChange={(e) => pickSheet(Number(e.target.value))} className={`${mfield} px-2`}>
                  {sheets.map((s, i) => (
                    <option key={i} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              {(["clients", "items"] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)} className={`rounded-control border-2 py-3 font-semibold ${layout.kind === k ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>
                  {k === "clients" ? `👥 ${t.m.clients}` : `📦 ${t.imp.itemsStock}`}
                </button>
              ))}
            </div>
            {layout.kind === "items" && shared && <p className="rounded-control bg-brand-soft p-2 text-sm text-brand-strong">{t.imp.sharedNote}</p>}
            <label className="block space-y-1.5">
              <span className={mlabel}>{t.imp.headerRow}</span>
              <select value={layout.headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))} className={`${mfield} px-2`}>
                <option value={-1}>{t.imp.noHeadings}</option>
                {sheet.rows.slice(0, 20).map((r, i) => (
                  <option key={i} value={i}>
                    {t.imp.row} {i + 1}: {r.filter(Boolean).slice(0, 4).join(" | ").slice(0, 50)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2 rounded-card bg-surface p-4 shadow-card">
            <p className="font-semibold">{t.imp.columns}</p>
            <p className="text-sm text-ink-subtle">{t.imp.columnsHint}</p>
            {fields.map((f) => (
              <label key={f} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm">
                  {t.imp.fields[f]}
                  {f === nameField && <span className="text-danger"> *</span>}
                </span>
                <select
                  value={layout.mapping[f] ?? ""}
                  onChange={(e) => setColumn(f, e.target.value === "" ? null : Number(e.target.value))}
                  className={`${mfield} min-w-0 px-2 py-2 text-base`}
                >
                  <option value="">—</option>
                  {Array.from({ length: width }, (_, c) => (
                    <option key={c} value={c}>
                      {colName(c)}
                      {headings[c] ? `: ${headings[c].slice(0, 30)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {records.length > 0 && (
              <div className="overflow-x-auto rounded-control border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-sunken text-ink-subtle">
                    <tr>
                      <th className="px-2 py-1">#</th>
                      {fields.filter((f) => layout.mapping[f] !== undefined).map((f) => (
                        <th key={f} className="px-2 py-1">
                          {t.imp.fields[f]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.slice(0, 5).map((r) => (
                      <tr key={r.rowNo} className="border-t border-line">
                        <td className="px-2 py-1 text-ink-subtle">{r.rowNo}</td>
                        {fields.filter((f) => layout.mapping[f] !== undefined).map((f) => (
                          <td key={f} className="max-w-32 break-words px-2 py-1">
                            {r[f] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-sm text-ink-muted">
              {records.length} {t.imp.rowsFound}
            </p>
          </div>

          <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
            {layout.kind === "items" ? (
              <>
                <fieldset className="space-y-2">
                  <legend className={mlabel}>{t.imp.stockQ}</legend>
                  {(["set", "add", "none"] as const).map((m) => (
                    <label key={m} className="flex items-start gap-3 rounded-control border-2 border-line p-3 has-[:checked]:border-brand">
                      <input
                        type="radio"
                        name="mode"
                        checked={stockMode === m}
                        onChange={() => {
                          setStockMode(m);
                          setPlan(null);
                        }}
                        className="mt-1 size-5"
                      />
                      <span>
                        <span className="block font-semibold">{t.imp.mode[m]}</span>
                        <span className="block text-sm text-ink-subtle">{t.imp.modeHint[m]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {stockMode !== "none" && layout.mapping.qty === undefined && <p className="rounded-control bg-status-pending-bg p-2 text-sm text-status-pending">{t.imp.noQtyColumn}</p>}
                <div className="grid grid-cols-2 gap-3">
                  {stockMode !== "none" && (
                    <label className="block space-y-1.5">
                      <span className={mlabel}>{t.imp.date}</span>
                      <input
                        type="date"
                        value={date}
                        max={today}
                        onChange={(e) => {
                          setDate(e.target.value || today);
                          setPlan(null);
                        }}
                        className={`${mfield} px-2`}
                      />
                    </label>
                  )}
                  <label className="block space-y-1.5">
                    <span className={mlabel}>{t.imp.defaultUnit}</span>
                    <input
                      value={defaultUnit}
                      onChange={(e) => {
                        setDefaultUnit(e.target.value);
                        setPlan(null);
                      }}
                      className={mfield}
                    />
                  </label>
                </div>
              </>
            ) : (
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => {
                    setOverwrite(e.target.checked);
                    setPlan(null);
                  }}
                  className="mt-1 size-5"
                />
                <span>
                  <span className="block font-semibold">{t.imp.overwrite}</span>
                  <span className="block text-sm text-ink-subtle">{t.imp.overwriteHint}</span>
                </span>
              </label>
            )}
            {records.length > MAX_ROWS && <p className="rounded-control bg-danger-soft p-2 text-sm text-danger">{t.imp.tooManyRows}</p>}
            <button
              disabled={busy || !mappedName || !records.length || records.length > MAX_ROWS}
              onClick={() => preview()}
              className="w-full rounded-control bg-brand py-3 text-lg font-semibold text-ink-inverse disabled:opacity-40"
            >
              {busy && !plan ? "…" : plan ? t.imp.checkAgain : t.imp.check}
            </button>
            {!mappedName && <p className="text-sm text-danger">{t.imp.needName}</p>}
          </div>

          {plan && counts && (
            <>
              <div className="sticky top-[4.5rem] z-[5] space-y-2 rounded-card bg-surface/95 p-3 shadow-card backdrop-blur">
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "choose", "new", "update", "same", "error", "skip"] as const).map((f) => {
                    const n = f === "all" ? plan.rows.length : counts[f];
                    if (f !== "all" && !n) return null;
                    return (
                      <button
                        key={f}
                        onClick={() => {
                          setFilter(f);
                          setShown(PAGE);
                        }}
                        className={`rounded-full px-3 py-1.5 text-sm font-semibold ${filter === f ? "bg-brand text-ink-inverse" : f === "all" ? "bg-sunken" : STATUS_STYLE[f]}`}
                      >
                        {f === "all" ? t.imp.all : t.imp.status[f]} {n}
                      </button>
                    );
                  })}
                </div>
                {counts.choose > 0 && (
                  <div className="flex gap-2 text-sm">
                    <button onClick={acceptSuggestions} className="flex-1 rounded-control border-2 border-status-pending/40 py-2 font-semibold text-status-pending">
                      {t.imp.acceptAll}
                    </button>
                    <button onClick={allNew} className="flex-1 rounded-control border-2 border-line-strong py-2 font-semibold">
                      {t.imp.allNew}
                    </button>
                  </div>
                )}
                <button disabled={busy || toSave === 0} onClick={apply} className="w-full rounded-control bg-go py-3 text-lg font-semibold text-ink-inverse disabled:opacity-40">
                  {busy ? "…" : `${t.imp.importN} ${toSave}`}
                </button>
                {counts.choose > 0 && <p className="text-xs text-status-pending">{t.imp.chooseLeft.replace("{n}", String(counts.choose))}</p>}
              </div>
              {list.slice(0, shown).map((r) => (
                <PlanCard key={r.rows[0]} t={t} kind={layout.kind} row={r} decision={decisions[r.rows[0]]} onDecide={(d) => decide(r.rows[0], d)} />
              ))}
              {list.length > shown && (
                <button onClick={() => setShown((s) => s + PAGE)} className="w-full rounded-control border-2 border-line-strong py-3 font-semibold">
                  {t.imp.more} ({list.length - shown})
                </button>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
