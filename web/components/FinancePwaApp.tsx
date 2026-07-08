"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { api, ApiResult, authStore, TokenPair } from "@/lib/api";
import { addCapture, flushCaptureQueue, listCaptures, QueuedCapture, removeCapture } from "@/lib/offlineQueue";

type Obj = Record<string, unknown>;
type Lang = "en" | "hi";
type Range = "30d" | "90d" | "ytd" | "custom";
type Resource<T> = { data?: T; error?: string; loading: boolean; status?: number; missing?: boolean; unauthorized?: boolean };

type Summary = { total?: number | string; rows?: Obj[]; comparison?: Obj | null };
type TimeSeries = { points?: Obj[] };
type Breakdown = { rows?: Obj[] };

const copy = {
  en: {
    title: "Cross-Border Finance",
    subtitle: "Private, document-first money control for US and India life.",
    login: "Sign in",
    signup: "Create account",
    authHint: "Use the backend auth API. Empty states below mean sign in or finish API setup, not demo data.",
    install: "Install app",
    refresh: "Refresh API data",
    offline: "Offline capture queue",
    empty: "No API data yet. Sign in, upload documents, or configure this backend module.",
    missing: "This endpoint is not available in the backend yet.",
    unauthorized: "Sign in again to load this surface.",
    onHold: "On hold: backend endpoint not present, so no fake functionality is shown.",
    capture: "Capture",
    dashboard: "Dashboard",
    transactions: "Transactions",
    analytics: "Analytics",
    budgets: "Budgets",
    debt: "Debt",
    income: "Income and equity",
    guidance: "Guidance and remittance",
    connections: "Connections",
    notifications: "Notifications",
    settings: "Settings and data",
  },
  hi: {
    title: "Cross-Border Finance",
    subtitle: "US-India paisa, receipts aur planning ek private jagah par.",
    login: "Sign in karein",
    signup: "Account banayein",
    authHint: "Backend auth API use hota hai. Khali screens demo nahi hain; sign in ya API setup chahiye.",
    install: "App install karein",
    refresh: "API data refresh",
    offline: "Offline capture queue",
    empty: "Abhi API data nahi hai. Sign in, documents upload, ya backend module configure karein.",
    missing: "Ye endpoint backend mein abhi available nahi hai.",
    unauthorized: "Is screen ko load karne ke liye dobara sign in karein.",
    onHold: "On hold: backend endpoint nahi hai, isliye fake feature nahi dikhaya gaya.",
    capture: "Capture",
    dashboard: "Dashboard",
    transactions: "Transactions",
    analytics: "Analytics",
    budgets: "Budgets",
    debt: "Debt",
    income: "Income aur equity",
    guidance: "Guidance aur remittance",
    connections: "Connections",
    notifications: "Notifications",
    settings: "Settings aur data",
  },
} satisfies Record<Lang, Record<string, string>>;

const surfaces = [
  "dashboard",
  "capture",
  "review",
  "transactions",
  "analytics",
  "budgets",
  "debt",
  "income",
  "guidance",
  "connections",
  "notifications",
  "settings",
] as const;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange(range: Range) {
  const end = new Date();
  const start = new Date(end);
  if (range === "90d") start.setDate(end.getDate() - 89);
  else if (range === "ytd") start.setMonth(0, 1);
  else start.setDate(end.getDate() - 29);
  return { from: isoDate(start), to: isoDate(end) };
}

function str(value: unknown, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, currency = "USD") {
  const amount = num(value);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function list<T = Obj>(resource?: Resource<T[]>) {
  return resource?.data ?? [];
}

function formText(form: FormData, key: string, fallback = "") {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formNumber(form: FormData, key: string) {
  return Number(formText(form, key, "0"));
}

function compactBody(body: Obj) {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== "" && value !== undefined && value !== null));
}

function parseOptionalJson(text: string) {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as Obj;
  } catch {
    throw new Error("Corrected payload must be valid JSON.");
  }
}

function ResourceState({ resource, empty }: { resource?: Resource<unknown>; empty: string }) {
  if (!resource) return null;
  if (resource.loading) return <p className="muted">Loading...</p>;
  if (resource.unauthorized) return <p className="notice warn">Sign in required for this API surface.</p>;
  if (resource.missing) return <p className="notice">Endpoint not available in this backend yet.</p>;
  if (resource.error) return <p className="notice warn">{resource.error}</p>;
  if (Array.isArray(resource.data) && resource.data.length === 0) return <p className="empty">{empty}</p>;
  return null;
}

function MiniBar({ value, max }: { value: unknown; max: number }) {
  const width = max > 0 ? Math.max(4, Math.min(100, (Math.abs(num(value)) / max) * 100)) : 0;
  return <span className="bar"><span style={{ width: `${width}%` }} /></span>;
}

export function FinancePwaApp() {
  const [lang, setLang] = useState<Lang>("en");
  const t = copy[lang];
  const [active, setActive] = useState<(typeof surfaces)[number]>("dashboard");
  const [isAuthed, setIsAuthed] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [mfa, setMfa] = useState<Obj | null>(null);
  const [status, setStatus] = useState<{ api: boolean; version?: string }>({ api: false });
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [range, setRange] = useState<Range>("30d");
  const [customRange, setCustomRange] = useState(defaultRange("30d"));
  const [isPending, startTransition] = useTransition();
  const [queue, setQueue] = useState<QueuedCapture[]>([]);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedTxn, setSelectedTxn] = useState<Obj | null>(null);
  const [guidanceAnswer, setGuidanceAnswer] = useState<Obj | null>(null);
  const [wizardAnswer, setWizardAnswer] = useState<Obj | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  const dates = range === "custom" ? customRange : defaultRange(range);
  const empty = t.empty;
  const [resources, setResources] = useState({
    documents: { loading: false } as Resource<Obj[]>,
    review: { loading: false } as Resource<Obj[]>,
    transactions: { loading: false } as Resource<Obj[]>,
    categories: { loading: false } as Resource<Obj[]>,
    tags: { loading: false } as Resource<Obj[]>,
    rules: { loading: false } as Resource<Obj[]>,
    summary: { loading: false } as Resource<Summary>,
    timeseries: { loading: false } as Resource<TimeSeries>,
    breakdown: { loading: false } as Resource<Breakdown>,
    budgets: { loading: false } as Resource<Obj[]>,
    recommendations: { loading: false } as Resource<Obj[]>,
    loans: { loading: false } as Resource<Obj[]>,
    incomeSources: { loading: false } as Resource<Obj[]>,
    grants: { loading: false } as Resource<Obj[]>,
    equityEvents: { loading: false } as Resource<Obj[]>,
    equitySummary: { loading: false } as Resource<Obj>,
    transfers: { loading: false } as Resource<Obj[]>,
    limits: { loading: false } as Resource<Obj>,
    household: { loading: false } as Resource<Obj>,
    members: { loading: false } as Resource<Obj[]>,
    settings: { loading: false } as Resource<Obj>,
    consents: { loading: false } as Resource<Obj[]>,
    notifications: { loading: false } as Resource<Obj[]>,
    notificationPrefs: { loading: false } as Resource<Obj>,
    bot: { loading: false } as Resource<Obj>,
  });

  const filteredTransactions = useMemo(() => {
    return list(resources.transactions).filter((txn) => {
      const date = str(txn.txn_date, "");
      return !date || (date >= dates.from && date <= dates.to);
    });
  }, [resources.transactions, dates.from, dates.to]);

  const topBreakdown = resources.breakdown.data?.rows ?? [];
  const maxBreakdown = Math.max(...topBreakdown.map((row) => Math.abs(num(row.total))), 0);

  async function loadQueue() {
    if (typeof indexedDB === "undefined") return;
    setQueue(await listCaptures());
  }

  async function loadStatus() {
    try {
      const [health, version] = await Promise.all([api.health(), api.version()]);
      setStatus({ api: health.status === "ok", version: version.version });
    } catch {
      setStatus({ api: false });
    }
  }

  async function fetchResource<T>(path: string): Promise<Resource<T>> {
    const result = await api.tryGet<T>(path);
    return result.ok
      ? { data: result.data, loading: false, status: result.status }
      : { error: result.error, loading: false, status: result.status, missing: result.missing, unauthorized: result.unauthorized };
  }

  function refreshAll() {
    startTransition(async () => {
      setResources((prev) => Object.fromEntries(Object.entries(prev).map(([key]) => [key, { loading: true }])) as typeof prev);
      const group = "group_by=category";
      const [
        documents,
        review,
        transactions,
        categories,
        tags,
        rules,
        summary,
        timeseries,
        breakdown,
        budgets,
        recommendations,
        loans,
        incomeSources,
        grants,
        equityEvents,
        equitySummary,
        transfers,
        limits,
        household,
        members,
        settings,
        consents,
        notifications,
        notificationPrefs,
        bot,
      ] = await Promise.all([
        fetchResource<Obj[]>("/documents"),
        fetchResource<Obj[]>("/review-queue"),
        fetchResource<Obj[]>("/transactions"),
        fetchResource<Obj[]>("/categories"),
        fetchResource<Obj[]>("/tags"),
        fetchResource<Obj[]>("/rules"),
        fetchResource<Summary>(`/analytics/summary?from=${dates.from}&to=${dates.to}&${group}&compare=previous`),
        fetchResource<TimeSeries>(`/analytics/timeseries?from=${dates.from}&to=${dates.to}&metric=spend&interval=monthly`),
        fetchResource<Breakdown>(`/analytics/breakdown?from=${dates.from}&to=${dates.to}&dimension=merchant`),
        fetchResource<Obj[]>("/budgets"),
        fetchResource<Obj[]>("/recommendations"),
        fetchResource<Obj[]>("/loans"),
        fetchResource<Obj[]>("/income-sources"),
        fetchResource<Obj[]>("/equity/grants"),
        fetchResource<Obj[]>("/equity/events"),
        fetchResource<Obj>("/equity/summary"),
        fetchResource<Obj[]>("/cross-border/transfers"),
        fetchResource<Obj>("/cross-border/limits"),
        fetchResource<Obj>("/household"),
        fetchResource<Obj[]>("/household/members"),
        fetchResource<Obj>("/settings"),
        fetchResource<Obj[]>("/consents"),
        fetchResource<Obj[]>("/notifications"),
        fetchResource<Obj>("/notification-preferences"),
        fetchResource<Obj>("/bot/link"),
      ]);
      setResources({ documents, review, transactions, categories, tags, rules, summary, timeseries, breakdown, budgets, recommendations, loans, incomeSources, grants, equityEvents, equitySummary, transfers, limits, household, members, settings, consents, notifications, notificationPrefs, bot });
      await loadQueue();
    });
  }

  useEffect(() => {
    setIsAuthed(Boolean(authStore.accessToken));
    const handler = (event: Event) => setInstallPrompt(event);
    window.addEventListener("beforeinstallprompt", handler);
    loadStatus();
    loadQueue();
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (isAuthed) refreshAll();
  }, [isAuthed, dates.from, dates.to]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    const form = new FormData(event.currentTarget);
    try {
      const tokens: TokenPair = authMode === "login"
        ? await api.login(formText(form, "email"), formText(form, "password"), formText(form, "totp"))
        : await api.signup({
            email: formText(form, "email"),
            password: formText(form, "password"),
            display_name: formText(form, "display_name"),
            household_name: formText(form, "household_name"),
            base_currency: formText(form, "base_currency", "USD"),
          });
      authStore.set(tokens);
      setIsAuthed(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed");
    }
  }

  async function submitJson(path: string, body: Obj, done?: (data: Obj) => void) {
    const result: ApiResult<Obj> = await api.tryPost(path, compactBody(body));
    if (result.ok) {
      done?.(result.data);
      refreshAll();
      return null;
    }
    return result.missing ? t.missing : result.error;
  }

  async function submitBody(path: string, body: unknown) {
    const result = await api.tryPost<unknown>(path, body);
    if (result.ok) {
      refreshAll();
      return null;
    }
    return result.missing ? t.missing : result.error;
  }

  async function handleCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fileValue = form.get("file");
    if (!(fileValue instanceof File) || !fileValue.size) return;
    const type = formText(form, "type", "receipt");
    const sourceLabel = formText(form, "source_label");
    if (!navigator.onLine) {
      await addCapture(fileValue, type, sourceLabel);
      setSyncMessage("Saved offline. It will sync when the API is reachable.");
    } else {
      const result = await api.tryUploadDocument(fileValue, { type, source_channel: "upload", source_label: sourceLabel });
      if (result.ok) setSyncMessage("Uploaded and queued for OCR.");
      else {
        await addCapture(fileValue, type, sourceLabel);
        setSyncMessage(`Upload failed; saved offline. ${result.error}`);
      }
      refreshAll();
    }
    event.currentTarget.reset();
    await loadQueue();
  }

  async function syncNow() {
    const result = await flushCaptureQueue();
    setSyncMessage(`Synced ${result.synced}; ${result.failed} still queued.`);
    await loadQueue();
    refreshAll();
  }

  function installApp() {
    if (!installPrompt) return;
    (installPrompt as Event & { prompt?: () => Promise<void> }).prompt?.();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">CBF</span>
          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>
        <div className="status-line">
          <span className={status.api ? "dot ok" : "dot bad"} /> API {status.api ? "online" : "unreachable"}
          <span>{status.version ?? "no version"}</span>
        </div>
        <nav className="nav-list" aria-label="App modules">
          {surfaces.map((surface) => (
            <button key={surface} className={active === surface ? "active" : ""} onClick={() => setActive(surface)}>
              {surface === "review" ? "Review queue" : t[surface as keyof typeof t] ?? surface}
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <select value={lang} onChange={(event) => setLang(event.target.value as Lang)} aria-label="Language">
            <option value="en">English</option>
            <option value="hi">Hindi/Hinglish</option>
          </select>
          <button onClick={installApp} disabled={!installPrompt}>{t.install}</button>
          <button onClick={refreshAll} disabled={!isAuthed || isPending}>{t.refresh}</button>
          {isAuthed && <button onClick={() => { authStore.clear(); setIsAuthed(false); }}>Sign out</button>}
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">M15 PWA</p>
            <h2>{active === "review" ? "Review queue" : t[active as keyof typeof t] ?? active}</h2>
          </div>
          <div className="range-controls">
            {(["30d", "90d", "ytd", "custom"] as Range[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item.toUpperCase()}</button>)}
            {range === "custom" && <><input type="date" value={customRange.from} onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))} /><input type="date" value={customRange.to} onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))} /></>}
          </div>
        </header>

        {!isAuthed && <AuthPanel mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} error={authError} hint={t.authHint} labels={{ login: t.login, signup: t.signup }} />}

        {active === "dashboard" && <Dashboard summary={resources.summary} timeseries={resources.timeseries} recommendations={resources.recommendations} txns={filteredTransactions} empty={empty} />}
        {active === "capture" && <Capture documents={resources.documents} queue={queue} onCapture={handleCapture} onSync={syncNow} onRemove={async (id) => { await removeCapture(id); await loadQueue(); }} message={syncMessage} empty={empty} />}
        {active === "review" && <ReviewQueue review={resources.review} documents={resources.documents} onResolve={async (id, action, data) => submitJson(`/review-queue/${id}/resolve`, { action, data: parseOptionalJson(data) })} empty={empty} />}
        {active === "transactions" && <Transactions txns={filteredTransactions} categories={list(resources.categories)} selected={selectedTxn} setSelected={setSelectedTxn} onCreate={async (body) => submitJson("/transactions", body)} onConfirm={async (id) => submitJson(`/transactions/${id}/confirm`, {})} onLineItems={async (id, items) => submitBody(`/transactions/${id}/line-items`, items)} empty={empty} />}
        {active === "analytics" && <Analytics summary={resources.summary} breakdown={resources.breakdown} timeseries={resources.timeseries} max={maxBreakdown} empty={empty} />}
        {active === "budgets" && <Budgets budgets={resources.budgets} recommendations={resources.recommendations} categories={list(resources.categories)} onCreate={async (body) => submitJson("/budgets", body)} onDismiss={async (id) => { await api.tryPost(`/recommendations/${id}/dismiss`); refreshAll(); }} empty={empty} />}
        {active === "debt" && <Debt loans={resources.loans} onCreate={async (body) => submitJson("/loans", body)} onStrategy={async (body, done) => submitJson("/loans/payoff-strategy", body, done)} empty={empty} />}
        {active === "income" && <Income sources={resources.incomeSources} grants={resources.grants} events={resources.equityEvents} summary={resources.equitySummary} onSource={async (body) => submitJson("/income-sources", body)} onGrant={async (body) => submitJson("/equity/grants", body)} empty={empty} />}
        {active === "guidance" && <Guidance transfers={resources.transfers} limits={resources.limits} answer={guidanceAnswer} wizard={wizardAnswer} onAsk={async (body) => submitJson("/guidance/ask", body, setGuidanceAnswer)} onWizard={async (body) => submitJson("/guidance/wizard", body, setWizardAnswer)} onTransfer={async (body) => submitJson("/cross-border/transfers", body)} empty={empty} />}
        {active === "connections" && <Connections bot={resources.bot} message={connectionMessage} setMessage={setConnectionMessage} refresh={refreshAll} empty={empty} />}
        {active === "notifications" && <Notifications center={resources.notifications} prefs={resources.notificationPrefs} onHold={t.onHold} empty={empty} />}
        {active === "settings" && <Settings household={resources.household} members={resources.members} settings={resources.settings} consents={resources.consents} mfa={mfa} setMfa={setMfa} message={settingsMessage} setMessage={setSettingsMessage} refresh={refreshAll} empty={empty} />}
      </section>
    </main>
  );
}

function AuthPanel({ mode, setMode, onSubmit, error, hint, labels }: { mode: "login" | "signup"; setMode: (mode: "login" | "signup") => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string | null; hint: string; labels: { login: string; signup: string } }) {
  return <section className="card auth-card"><div><h3>{mode === "login" ? labels.login : labels.signup}</h3><p>{hint}</p></div><form onSubmit={onSubmit} className="grid-form"><input name="email" type="email" placeholder="email@example.com" required /><input name="password" type="password" placeholder="Password" required />{mode === "login" && <input name="totp" inputMode="numeric" placeholder="MFA code if enabled" />}{mode === "signup" && <><input name="display_name" placeholder="Display name" /><input name="household_name" placeholder="Household name" /><input name="base_currency" maxLength={3} placeholder="USD" /></>}<button>{mode === "login" ? labels.login : labels.signup}</button><button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? labels.signup : labels.login}</button>{error && <p className="notice warn">{error}</p>}<p className="muted">Passkeys/WebAuthn are shown as unavailable until backend endpoints exist.</p></form></section>;
}

function Dashboard({ summary, timeseries, recommendations, txns, empty }: { summary: Resource<Summary>; timeseries: Resource<TimeSeries>; recommendations: Resource<Obj[]>; txns: Obj[]; empty: string }) {
  const points = timeseries.data?.points ?? [];
  return <div className="module-grid"><section className="card hero-card"><p className="eyebrow">Takeaway</p><h3>{summary.data ? `Tracked spend: ${money(summary.data.total)}` : "Connect data to see your money picture."}</h3><ResourceState resource={summary} empty={empty} /></section><section className="card"><h3>Recent activity</h3><ResourceState resource={{ ...summary, data: txns }} empty={empty} /><div className="compact-list">{txns.slice(0, 5).map((txn) => <div key={str(txn.id)}><strong>{str(txn.merchant, "Unlabeled")}</strong><span>{money(txn.amount, str(txn.currency, "USD"))} on {str(txn.txn_date)}</span></div>)}</div></section><section className="card"><h3>Trend</h3><ResourceState resource={timeseries as Resource<unknown>} empty={empty} />{points.map((point) => <div key={str(point.period)} className="row"><span>{str(point.period)}</span><MiniBar value={point.spend} max={Math.max(...points.map((p) => num(p.spend)), 0)} /><b>{money(point.spend)}</b></div>)}</section><section className="card"><h3>Recommendations</h3><ResourceState resource={recommendations as Resource<unknown>} empty={empty} /><div className="compact-list">{list(recommendations).map((item) => <div key={str(item.id)}><strong>{str(item.type)}</strong><span>{JSON.stringify(item.payload ?? {})}</span></div>)}</div></section></div>;
}

function Capture({ documents, queue, onCapture, onSync, onRemove, message, empty }: { documents: Resource<Obj[]>; queue: QueuedCapture[]; onCapture: (event: FormEvent<HTMLFormElement>) => void; onSync: () => void; onRemove: (id: string) => void; message: string | null; empty: string }) {
  return <div className="module-grid"><section className="card hero-card"><h3>Receipt, statement, CSV, paystub upload</h3><form onSubmit={onCapture} className="grid-form"><input name="file" type="file" accept="image/*,.pdf,.csv" capture="environment" required /><select name="type"><option value="receipt">Receipt</option><option value="statement">Statement</option><option value="paystub">Paystub</option><option value="invoice">Invoice</option><option value="csv">CSV</option><option value="other">Other</option></select><input name="source_label" placeholder="Source label, e.g. Chase CSV" /><button>Upload or queue</button></form>{message && <p className="notice">{message}</p>}</section><section className="card"><h3>CSV mapping wizard</h3><p className="muted">Save mappings only when the backend `/documents/csv-mappings` endpoint is reachable.</p><CsvMappingForm /></section><section className="card"><h3>Queued offline captures</h3><button onClick={onSync}>Sync now</button><div className="compact-list">{queue.length === 0 && <p className="empty">No offline captures queued.</p>}{queue.map((item) => <div key={item.id}><strong>{item.filename}</strong><span>{item.type} - attempts {item.attempts} {item.lastError ? `- ${item.lastError}` : ""}</span><button className="ghost" onClick={() => onRemove(item.id)}>Remove</button></div>)}</div></section><section className="card"><h3>Documents</h3><ResourceState resource={documents as Resource<unknown>} empty={empty} /><div className="compact-list">{list(documents).map((doc) => <div key={str(doc.id)}><strong>{str(doc.original_filename, str(doc.type))}</strong><span>{str(doc.status)} - {str(doc.source_channel)} - {str(doc.created_at)}</span></div>)}</div></section></div>;
}

function CsvMappingForm() {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const f = new FormData(event.currentTarget); const result = await api.tryPut<Obj>("/documents/csv-mappings", { source_label: formText(f, "source_label"), date: formText(f, "date"), description: formText(f, "description"), amount: formText(f, "amount"), currency: formText(f, "currency"), default_currency: formText(f, "default_currency", "USD") }); setMessage(result.ok ? "Mapping saved." : result.error); }
  return <form onSubmit={submit} className="grid-form"><input name="source_label" placeholder="Label" required /><input name="date" placeholder="Date column" required /><input name="description" placeholder="Description column" required /><input name="amount" placeholder="Amount column" required /><input name="currency" placeholder="Currency column" /><input name="default_currency" placeholder="USD" /><button>Save mapping</button>{message && <p className="notice">{message}</p>}</form>;
}

function ReviewQueue({ review, documents, onResolve, empty }: { review: Resource<Obj[]>; documents: Resource<Obj[]>; onResolve: (id: string, action: string, data: string) => Promise<string | null>; empty: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return <section className="card"><h3>Human review</h3><p className="muted">Confirm low-confidence OCR or reject bad extraction. Receipt-to-statement linking is available from transaction detail.</p><ResourceState resource={review as Resource<unknown>} empty={empty} /><div className="review-list">{list(review).map((item) => <form key={str(item.document_id)} onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); try { setMessage(await onResolve(str(item.document_id), formText(f, "action", "confirm"), formText(f, "data"))); } catch (err) { setMessage(err instanceof Error ? err.message : "Review update failed"); } }}><h4>{str(item.type)} - confidence {str(item.confidence)}</h4><pre>{JSON.stringify(item.summary ?? {}, null, 2)}</pre><textarea name="data" placeholder="Optional corrected JSON" /><select name="action"><option value="confirm">Confirm</option><option value="reject">Reject</option></select><button>Resolve</button></form>)}</div>{message && <p className="notice warn">{message}</p>}<h3>Documents needing context</h3><div className="compact-list">{list(documents).filter((doc) => doc.status === "needs_review").map((doc) => <div key={str(doc.id)}><strong>{str(doc.original_filename, str(doc.id))}</strong><span>{JSON.stringify(doc.summary ?? {})}</span></div>)}</div></section>;
}

function Transactions({ txns, categories, selected, setSelected, onCreate, onConfirm, onLineItems, empty }: { txns: Obj[]; categories: Obj[]; selected: Obj | null; setSelected: (txn: Obj | null) => void; onCreate: (body: Obj) => Promise<string | null>; onConfirm: (id: string) => Promise<string | null>; onLineItems: (id: string, items: Obj[]) => Promise<string | null>; empty: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return <div className="two-pane"><section className="card"><h3>Manual transaction</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onCreate({ merchant: formText(f, "merchant"), amount: formNumber(f, "amount"), currency: formText(f, "currency", "USD"), txn_date: formText(f, "txn_date", isoDate(new Date())), category_id: formText(f, "category_id"), notes: formText(f, "notes"), source_channel: "manual", status: "draft" })); }}><input name="merchant" placeholder="Merchant" /><input name="amount" type="number" step="0.01" placeholder="Amount" required /><input name="currency" placeholder="USD" /><input name="txn_date" type="date" required /><select name="category_id"><option value="">No category</option>{categories.map((c) => <option key={str(c.id)} value={str(c.id)}>{str(c.name)}</option>)}</select><input name="notes" placeholder="Notes" /><button>Add transaction</button></form>{message && <p className="notice warn">{message}</p>}<h3>Transactions</h3>{txns.length === 0 && <p className="empty">{empty}</p>}<div className="table-list">{txns.map((txn) => <button key={str(txn.id)} onClick={() => setSelected(txn)} className={selected?.id === txn.id ? "active" : ""}><span>{str(txn.merchant, "Unlabeled")}</span><b>{money(txn.amount, str(txn.currency, "USD"))}</b><small>{str(txn.txn_date)} - {str(txn.status)}</small></button>)}</div></section><section className="card detail-card"><h3>Line item breakdown</h3>{!selected && <p className="empty">Select a transaction to drill down.</p>}{selected && <><h4>{str(selected.merchant, "Unlabeled")}</h4><p>{money(selected.amount, str(selected.currency, "USD"))} - confidence {str(selected.confidence)}</p><button onClick={async () => setMessage(await onConfirm(str(selected.id)))}>Confirm</button><div className="compact-list">{Array.isArray(selected.line_items) && selected.line_items.length > 0 ? selected.line_items.map((item) => <div key={str((item as Obj).id, str((item as Obj).name))}><strong>{str((item as Obj).name)}</strong><span>{money((item as Obj).amount, str(selected.currency, "USD"))} qty {str((item as Obj).quantity)}</span></div>) : <p className="empty">No itemized receipt data for this transaction.</p>}</div><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onLineItems(str(selected.id), [{ name: formText(f, "name"), amount: formNumber(f, "amount"), quantity: formNumber(f, "quantity") || undefined }])); }}><input name="name" placeholder="Line item" /><input name="amount" type="number" step="0.01" placeholder="Amount" /><input name="quantity" type="number" step="0.01" placeholder="Qty" /><button>Add line item</button></form></>}</section></div>;
}

function Analytics({ summary, breakdown, timeseries, max, empty }: { summary: Resource<Summary>; breakdown: Resource<Breakdown>; timeseries: Resource<TimeSeries>; max: number; empty: string }) {
  const rows = breakdown.data?.rows ?? [];
  return <div className="module-grid"><section className="card"><h3>Faceted merchant view</h3><ResourceState resource={breakdown as Resource<unknown>} empty={empty} />{rows.map((row) => <div key={JSON.stringify(row.dimensions)} className="row"><span>{str((row.dimensions as Obj)?.merchant, "Unknown")}</span><MiniBar value={row.total} max={max} /><b>{money(row.total)}</b></div>)}</section><section className="card"><h3>Category summary</h3><ResourceState resource={summary as Resource<unknown>} empty={empty} />{(summary.data?.rows ?? []).map((row) => <div key={JSON.stringify(row.dimensions)} className="row"><span>{str((row.dimensions as Obj)?.category, "Uncategorized")}</span><b>{money(row.total)}</b></div>)}</section><section className="card"><h3>Contribution series</h3><ResourceState resource={timeseries as Resource<unknown>} empty={empty} />{(timeseries.data?.points ?? []).map((point) => <div key={str(point.period)} className="row"><span>{str(point.period)}</span><span>Income {money(point.income)} / spend {money(point.spend)}</span><b>{money(point.net)}</b></div>)}</section></div>;
}

function Budgets({ budgets, recommendations, categories, onCreate, onDismiss, empty }: { budgets: Resource<Obj[]>; recommendations: Resource<Obj[]>; categories: Obj[]; onCreate: (body: Obj) => Promise<string | null>; onDismiss: (id: string) => void; empty: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return <div className="module-grid"><section className="card"><h3>Create budget</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onCreate({ category_id: formText(f, "category_id"), period: formText(f, "period", "monthly"), amount: formNumber(f, "amount"), currency: formText(f, "currency", "USD") })); }}><select name="category_id"><option value="">All categories</option>{categories.map((c) => <option key={str(c.id)} value={str(c.id)}>{str(c.name)}</option>)}</select><select name="period"><option>monthly</option><option>weekly</option><option>annual</option></select><input name="amount" type="number" step="0.01" placeholder="Amount" /><input name="currency" placeholder="USD" /><button>Create</button></form>{message && <p className="notice warn">{message}</p>}</section><section className="card"><h3>Budgets</h3><ResourceState resource={budgets as Resource<unknown>} empty={empty} />{list(budgets).map((b) => <div key={str(b.id)} className="row"><span>{str(b.period)} {str(b.currency)}</span><MiniBar value={b.progress_pct} max={100} /><b>{money(b.spent, str(b.currency, "USD"))} / {money(b.amount, str(b.currency, "USD"))}</b></div>)}</section><section className="card"><h3>Budget alerts and recommendations</h3><ResourceState resource={recommendations as Resource<unknown>} empty={empty} />{list(recommendations).map((r) => <div key={str(r.id)} className="compact-card"><strong>{str(r.type)}</strong><pre>{JSON.stringify(r.payload ?? {}, null, 2)}</pre><button className="ghost" onClick={() => onDismiss(str(r.id))}>Dismiss</button></div>)}</section></div>;
}

function Debt({ loans, onCreate, onStrategy, empty }: { loans: Resource<Obj[]>; onCreate: (body: Obj) => Promise<string | null>; onStrategy: (body: Obj, done: (data: Obj) => void) => Promise<string | null>; empty: string }) {
  const [message, setMessage] = useState<string | null>(null); const [strategy, setStrategy] = useState<Obj | null>(null);
  return <div className="module-grid"><section className="card"><h3>Add loan</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onCreate({ name: formText(f, "name"), type: formText(f, "type", "other"), principal: formNumber(f, "principal"), currency: formText(f, "currency", "USD"), interest_rate: formNumber(f, "interest_rate"), min_or_emi_amount: formNumber(f, "min_or_emi_amount"), due_day: formNumber(f, "due_day") || undefined, start_date: formText(f, "start_date") })); }}><input name="name" placeholder="Loan name" /><input name="type" placeholder="mortgage/student/auto/other" /><input name="principal" type="number" step="0.01" placeholder="Principal" /><input name="currency" placeholder="USD" /><input name="interest_rate" type="number" step="0.01" placeholder="APR" /><input name="min_or_emi_amount" type="number" step="0.01" placeholder="Minimum/EMI" /><input name="due_day" type="number" min="1" max="31" placeholder="Due day" /><input name="start_date" type="date" /><button>Add loan</button></form>{message && <p className="notice warn">{message}</p>}</section><section className="card"><h3>Loans</h3><ResourceState resource={loans as Resource<unknown>} empty={empty} />{list(loans).map((loan) => <div key={str(loan.id)} className="compact-card"><strong>{str(loan.name)} - {money(loan.principal, str(loan.currency, "USD"))}</strong><span>{str(loan.interest_rate)}% APR - next due {str(loan.next_due_date)}</span>{loan.penalty_warning ? <p className="notice warn">{str(loan.penalty_warning)}</p> : null}</div>)}</section><section className="card"><h3>Snowball / avalanche</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onStrategy({ strategy: formText(f, "strategy", "snowball"), extra_monthly_payment: formNumber(f, "extra") }, setStrategy)); }}><select name="strategy"><option value="snowball">Snowball</option><option value="avalanche">Avalanche</option></select><input name="extra" type="number" step="0.01" placeholder="Extra monthly payment" /><button>Calculate</button></form>{strategy && <pre>{JSON.stringify(strategy, null, 2)}</pre>}</section></div>;
}

function Income({ sources, grants, events, summary, onSource, onGrant, empty }: { sources: Resource<Obj[]>; grants: Resource<Obj[]>; events: Resource<Obj[]>; summary: Resource<Obj>; onSource: (body: Obj) => Promise<string | null>; onGrant: (body: Obj) => Promise<string | null>; empty: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return <div className="module-grid"><section className="card"><h3>Income source</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onSource({ employer: formText(f, "employer"), country: formText(f, "country"), currency: formText(f, "currency", "USD"), frequency: formText(f, "frequency", "monthly"), gross: formNumber(f, "gross"), net: formNumber(f, "net") })); }}><input name="employer" placeholder="Employer" /><input name="country" placeholder="US/IN" /><input name="currency" placeholder="USD" /><select name="frequency"><option>monthly</option><option>biweekly</option><option>annual</option></select><input name="gross" type="number" step="0.01" placeholder="Gross" /><input name="net" type="number" step="0.01" placeholder="Net" /><button>Save source</button></form>{message && <p className="notice warn">{message}</p>}</section><section className="card"><h3>Sources</h3><ResourceState resource={sources as Resource<unknown>} empty={empty} />{list(sources).map((s) => <div key={str(s.id)} className="row"><span>{str(s.employer, "Income")}</span><span>{str(s.country)} {str(s.frequency)}</span><b>{money(s.net ?? s.gross, str(s.currency, "USD"))}</b></div>)}</section><section className="card"><h3>Equity grant</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onGrant({ income_source_id: formText(f, "income_source_id"), type: formText(f, "type", "RSU"), ticker: formText(f, "ticker"), country: formText(f, "country"), grant_date: formText(f, "grant_date"), shares: formNumber(f, "shares"), strike_price: formNumber(f, "strike_price") })); }}><select name="income_source_id"><option value="">Income source</option>{list(sources).map((s) => <option key={str(s.id)} value={str(s.id)}>{str(s.employer, str(s.id))}</option>)}</select><input name="type" placeholder="RSU/ESPP/ISO/NSO" /><input name="ticker" placeholder="Ticker" /><input name="country" placeholder="Country" /><input name="grant_date" type="date" /><input name="shares" type="number" step="0.01" placeholder="Shares" /><input name="strike_price" type="number" step="0.01" placeholder="Strike" /><button>Add grant</button></form></section><section className="card"><h3>Equity summary</h3><ResourceState resource={summary as Resource<unknown>} empty={empty} />{summary.data && <pre>{JSON.stringify(summary.data, null, 2)}</pre>}<h4>Grants</h4>{list(grants).map((g) => <div key={str(g.id)} className="row"><span>{str(g.type)} {str(g.ticker)}</span><b>{str(g.shares)} shares</b></div>)}<h4>Events</h4>{list(events).map((e) => <div key={str(e.id)} className="row"><span>{str(e.type)} {str(e.event_date)}</span><b>{money(e.proceeds)}</b></div>)}</section></div>;
}

function Guidance({ transfers, limits, answer, wizard, onAsk, onWizard, onTransfer, empty }: { transfers: Resource<Obj[]>; limits: Resource<Obj>; answer: Obj | null; wizard: Obj | null; onAsk: (body: Obj) => Promise<string | null>; onWizard: (body: Obj) => Promise<string | null>; onTransfer: (body: Obj) => Promise<string | null>; empty: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return <div className="module-grid"><section className="card"><h3>Ask cited guidance</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onAsk({ question: formText(f, "question"), country: formText(f, "country"), topic: formText(f, "topic") })); }}><textarea name="question" placeholder="Ask about LRS, TCS, FBAR, FATCA, DTAA..." required /><input name="country" placeholder="US/IN" /><input name="topic" placeholder="Topic" /><button>Ask</button></form>{answer && <div className="answer"><p>{str(answer.answer)}</p><pre>{JSON.stringify(answer.citations ?? [], null, 2)}</pre><small>{str(answer.disclaimer)}</small></div>}</section><section className="card"><h3>Cross-border wizard</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onWizard({ countries: formText(f, "countries", "US,IN").split(",").map((x) => x.trim()), residency: formText(f, "residency"), annual_transfer_amount: formNumber(f, "amount"), transfer_currency: formText(f, "currency", "USD") })); }}><input name="countries" placeholder="US,IN" /><input name="residency" placeholder="Residency" /><input name="amount" type="number" step="0.01" placeholder="Annual transfer amount" /><input name="currency" placeholder="USD" /><button>Build checklist</button></form>{wizard && <pre>{JSON.stringify(wizard, null, 2)}</pre>}</section><section className="card"><h3>Remittance tracker</h3><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setMessage(await onTransfer({ direction: formText(f, "direction", "US_TO_IN"), from_currency: formText(f, "from", "USD"), to_currency: formText(f, "to", "INR"), amount: formNumber(f, "amount"), fx_rate: formNumber(f, "fx_rate"), purpose: formText(f, "purpose"), channel: formText(f, "channel"), transfer_date: formText(f, "date", isoDate(new Date())) })); }}><input name="direction" placeholder="US_TO_IN" /><input name="from" placeholder="USD" /><input name="to" placeholder="INR" /><input name="amount" type="number" step="0.01" placeholder="Amount" /><input name="fx_rate" type="number" step="0.0001" placeholder="FX rate" /><input name="purpose" placeholder="Purpose" /><input name="channel" placeholder="Wise/bank" /><input name="date" type="date" /><button>Track</button></form><ResourceState resource={transfers as Resource<unknown>} empty={empty} />{list(transfers).map((tr) => <div key={str(tr.id)} className="row"><span>{str(tr.direction)} {str(tr.transfer_date)}</span><b>{money(tr.amount, str(tr.from_currency, "USD"))}</b></div>)}</section><section className="card"><h3>Limits and warnings</h3><ResourceState resource={limits as Resource<unknown>} empty={empty} />{limits.data && <pre>{JSON.stringify(limits.data, null, 2)}</pre>}{message && <p className="notice warn">{message}</p>}</section></div>;
}

function Connections({ bot, message, setMessage, refresh, empty }: { bot: Resource<Obj>; message: string | null; setMessage: (message: string | null) => void; refresh: () => void; empty: string }) {
  async function run(label: string, path: string, body?: Obj) { const result = await api.tryPost<Obj>(path, body ?? {}); setMessage(result.ok ? `${label}: ${JSON.stringify(result.data)}` : `${label}: ${result.missing ? "endpoint unavailable" : result.error}`); refresh(); }
  return <div className="module-grid"><section className="card"><h3>Plaid</h3><p className="muted">Creates link tokens and syncs only if Plaid backend credentials are configured.</p><button onClick={() => run("Plaid link token", "/plaid/link-token")}>Create link token</button><form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await run("Plaid exchange", "/plaid/exchange", { public_token: formText(f, "token"), institution_name: formText(f, "institution") }); }}><input name="token" placeholder="public_token from Plaid Link" /><input name="institution" placeholder="Institution" /><button>Exchange</button></form><button onClick={() => run("Plaid sync", "/plaid/sync")}>Sync Plaid</button></section><section className="card"><h3>Gmail and email</h3><button onClick={() => run("Gmail OAuth", "/email/oauth/start")}>Start OAuth</button><button onClick={() => run("Email sync", "/email/sync")}>Sync email</button></section><section className="card"><h3>SMS forwarder</h3><button onClick={() => run("SMS token", "/sms/token/rotate")}>Rotate setup token</button><p className="muted">Paste the returned webhook URL and token into your Android SMS-to-HTTP forwarder. Financial SMS is opt-in only.</p></section><section className="card"><h3>Bot linking</h3><ResourceState resource={bot as Resource<unknown>} empty={empty} /><p className="notice">{bot.missing ? "On hold: /bot/link is not mounted in this backend, so bot linking is disabled." : "If /bot/link is available, refresh shows its API response here."}</p></section>{message && <section className="card full"><p className="notice">{message}</p></section>}</div>;
}

function Notifications({ center, prefs, onHold, empty }: { center: Resource<Obj[]>; prefs: Resource<Obj>; onHold: string; empty: string }) {
  return <div className="module-grid"><section className="card"><h3>Notifications center</h3><ResourceState resource={center as Resource<unknown>} empty={empty} />{center.missing && <p className="notice">{onHold}</p>}{list(center).map((n) => <div key={str(n.id)} className="compact-card"><strong>{str(n.type, "Notification")}</strong><span>{str(n.status)} - {str(n.created_at)}</span><pre>{JSON.stringify(n.payload ?? {}, null, 2)}</pre></div>)}</section><section className="card"><h3>Preferences</h3><ResourceState resource={prefs as Resource<unknown>} empty={empty} />{prefs.missing && <p className="notice">Preferences endpoint is not available. Budget and loan notifications may still be queued server-side without a UI API.</p>}{prefs.data && <pre>{JSON.stringify(prefs.data, null, 2)}</pre>}<p className="muted">Web push registration is handled by the PWA service worker once a backend subscription endpoint exists.</p></section></div>;
}

function Settings({ household, members, settings, consents, mfa, setMfa, message, setMessage, refresh, empty }: { household: Resource<Obj>; members: Resource<Obj[]>; settings: Resource<Obj>; consents: Resource<Obj[]>; mfa: Obj | null; setMfa: (mfa: Obj | null) => void; message: string | null; setMessage: (message: string | null) => void; refresh: () => void; empty: string }) {
  async function post(path: string, body?: Obj) { const result = await api.tryPost<Obj>(path, body ?? {}); setMessage(result.ok ? JSON.stringify(result.data ?? "ok") : result.error); refresh(); return result; }
  return <div className="module-grid"><section className="card"><h3>Household</h3><ResourceState resource={household as Resource<unknown>} empty={empty} />{household.data && <pre>{JSON.stringify(household.data, null, 2)}</pre>}<h4>Members</h4><ResourceState resource={members as Resource<unknown>} empty={empty} />{list(members).map((m) => <div key={str(m.id)} className="row"><span>{str(m.email)}</span><span>{str(m.role)} {m.mfa_enabled ? "MFA" : "no MFA"}</span></div>)}<form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await post("/household/invite", { email: formText(f, "email"), role: formText(f, "role", "member") }); }}><input name="email" type="email" placeholder="Invite email" /><select name="role"><option>member</option><option>viewer</option><option>owner</option></select><button>Invite</button></form></section><section className="card"><h3>MFA and passkeys</h3><button onClick={async () => { const result = await post("/auth/mfa/enroll"); if (result.ok) setMfa(result.data); }}>Enroll TOTP</button>{mfa && <pre>{JSON.stringify(mfa, null, 2)}</pre>}<form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await post("/auth/mfa/verify", { totp_code: formText(f, "code") }); }}><input name="code" inputMode="numeric" placeholder="TOTP code" /><button>Verify MFA</button></form><p className="notice">Passkey/WebAuthn backend endpoints are not mounted, so biometric unlock is on hold.</p></section><section className="card"><h3>Core settings</h3><ResourceState resource={settings as Resource<unknown>} empty={empty} />{settings.missing && <p className="notice">Settings PATCH is M16 backend work; this UI will use it when present.</p>}{settings.data && <pre>{JSON.stringify(settings.data, null, 2)}</pre>}<form className="grid-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const result = await api.tryPatch<Obj>("/settings", { base_currency: formText(f, "base_currency"), language: formText(f, "language") }); setMessage(result.ok ? "Settings saved." : result.error); refresh(); }}><input name="base_currency" placeholder="USD" /><select name="language"><option value="en">English</option><option value="hi">Hindi/Hinglish</option></select><button>Save settings</button></form></section><section className="card"><h3>Data controls</h3><p><a href={`${api.baseUrl}/export?format=csv`}>Export CSV</a> <a href={`${api.baseUrl}/export?format=pdf`}>Export PDF</a></p><ResourceState resource={consents as Resource<unknown>} empty={empty} />{consents.missing && <p className="notice">Export, consent revoke, and account delete endpoints are only enabled when M16 backend exists.</p>}{list(consents).map((c) => <div key={str(c.id, str(c.channel))} className="row"><span>{str(c.channel)}</span><button className="ghost" onClick={() => post(`/consents/${str(c.channel)}/revoke`)}>Revoke</button></div>)}<button className="danger" onClick={async () => { if (confirm("Delete the full account? This requires backend DELETE /account.")) { const result = await api.tryDelete<Obj>("/account"); setMessage(result.ok ? "Account delete requested." : result.error); } }}>Delete account</button></section>{message && <section className="card full"><p className="notice warn">{message}</p></section>}</div>;
}
