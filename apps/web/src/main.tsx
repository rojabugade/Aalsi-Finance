import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatMoney, type CrossBorderTransfer, type Debt, type Insight, type SalaryIncome, type Transaction } from "@finance/shared";
import "./styles.css";

type DebtWithPayoff = Debt & { payoffMonths: number | null };
type Page = "home" | "spend" | "insights" | "income" | "debt" | "cards" | "investments" | "goals" | "connections" | "privacy";
type PageTab = string;

type Overview = {
  transactions: Transaction[];
  debts: DebtWithPayoff[];
  salary: SalaryIncome[];
  transfers: CrossBorderTransfer[];
  categorySummary: Record<string, number>;
  merchantSummary: {
    merchant: string;
    total: number;
    contributions: Record<string, number>;
  };
  insights: Insight[];
};

type Metrics = {
  usdSpend: number;
  inrSpend: number;
  monthlyIncome: number;
  debtTotal: number;
  safeToSpend: number;
  savingsRate: number;
};

type AuthUser = { id: string; email: string; name: string };
type ImportResult = {
  importedCount: number;
  files: {
    fileName: string;
    documentType: string;
    detectedMerchant: string;
    detectedCategory: string;
    confidence: number;
    needsReview?: boolean;
    reviewMessage?: string;
    evidence: string[];
  }[];
};
type ConnectionState = {
  id: string;
  name: string;
  category: string;
  status: "connected" | "not_connected" | "needs_config";
  lastSync: string | null;
  dataUsed: string[];
  permissionScope: string;
  privacyNote: string;
};

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

const pages: { id: Page; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "spend", label: "Spend" },
  { id: "insights", label: "Insights" },
  { id: "income", label: "Income" },
  { id: "debt", label: "Debt" },
  { id: "cards", label: "Cards" },
  { id: "investments", label: "Investments" },
  { id: "goals", label: "Goals" },
  { id: "connections", label: "Connections" },
  { id: "privacy", label: "Privacy" }
];

const pageTabs: Record<Page, { id: string; label: string }[]> = {
  home: [
    { id: "overview", label: "Overview" },
    { id: "goals", label: "Goals" },
    { id: "recommendations", label: "Recommendations" }
  ],
  spend: [
    { id: "transactions", label: "Transactions" },
    { id: "merchants", label: "Merchants" },
    { id: "items", label: "Items" },
    { id: "recurring", label: "Recurring" }
  ],
  insights: [
    { id: "overview", label: "Overview" },
    { id: "report", label: "AI report" },
    { id: "affordability", label: "Affordability" },
    { id: "evidence", label: "Evidence" }
  ],
  income: [
    { id: "overview", label: "Overview" },
    { id: "sources", label: "Sources" },
    { id: "cashflow", label: "Cash flow" }
  ],
  debt: [
    { id: "overview", label: "Overview" },
    { id: "loans", label: "Loans" },
    { id: "payoff", label: "Payoff" }
  ],
  cards: [
    { id: "overview", label: "Overview" },
    { id: "utilization", label: "Utilization" },
    { id: "due-dates", label: "Due dates" }
  ],
  investments: [
    { id: "overview", label: "Overview" },
    { id: "readiness", label: "Readiness" },
    { id: "india", label: "India research" }
  ],
  goals: [
    { id: "overview", label: "Overview" },
    { id: "active", label: "Active goals" },
    { id: "progress", label: "Progress" }
  ],
  connections: [
    { id: "overview", label: "Overview" },
    { id: "banks-cards", label: "Banks & Cards" },
    { id: "imports", label: "Imports" }
  ],
  privacy: [
    { id: "consent", label: "Consent" },
    { id: "redaction", label: "Redaction" },
    { id: "audit", label: "Audit logs" }
  ]
};

const budgetLimits: Record<string, number> = {
  Housing: 4200,
  Food: 1120,
  Shopping: 1120,
  Travel: 700,
  Transfer: 2200,
  Debt: 2840
};

function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [page, setPage] = useState<Page>(getPageFromHash());
  const [activeTab, setActiveTab] = useState<PageTab>(getTabFromHash(getPageFromHash()));
  const [selectedMerchant, setSelectedMerchant] = useState(getMerchantFromHash());
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("finance_auth_token") ?? "");
  const [user, setUser] = useState<AuthUser | null>(() => {
    const savedUser = localStorage.getItem("finance_auth_user");
    return savedUser ? JSON.parse(savedUser) as AuthUser : null;
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    amount: "",
    merchant: "",
    category: "Food",
    subcategory: "",
    currency: "USD",
    date: new Date().toISOString().slice(0, 10)
  });

  async function loadOverview() {
    if (!authToken) {
      return;
    }

    const response = await fetch(`${apiBase}/api/overview`, { headers: authHeaders(authToken) });
    if (response.status === 401) {
      clearSavedAuth();
      setAuthToken("");
      setUser(null);
      setOverview(null);
      return;
    }

    if (!response.ok) {
      throw new Error("Unable to load finance overview");
    }
    setOverview(await response.json());
  }

  useEffect(() => {
    if (!authToken) {
      return;
    }

    loadOverview().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Something went wrong");
    });
  }, [authToken]);

  useEffect(() => {
    function handleHashChange() {
      setPage(getPageFromHash());
      setActiveTab(getTabFromHash(getPageFromHash()));
      setSelectedMerchant(getMerchantFromHash());
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  async function submitTransaction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch(`${apiBase}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
      body: JSON.stringify({
        amount: Number(form.amount),
        merchant: form.merchant,
        category: form.category,
        subcategory: form.subcategory || undefined,
        currency: form.currency,
        date: form.date,
        tags: [form.category],
        source: "manual",
        country: form.currency === "INR" ? "IN" : "US"
      })
    });

    if (!response.ok) {
      setError("Could not save transaction. Check required fields.");
      return;
    }

    setForm(previous => ({ ...previous, amount: "", merchant: "", subcategory: "" }));
    await loadOverview();
  }

  async function submitAuth(mode: "login" | "register", values: { email: string; password: string; name: string }) {
    setAuthError(null);
    const response = await fetch(`${apiBase}/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    const payload = await response.json() as { token?: string; user?: AuthUser; error?: string };

    if (!response.ok || !payload.token || !payload.user) {
      setAuthError(payload.error ?? "Authentication failed.");
      return;
    }

    localStorage.setItem("finance_auth_token", payload.token);
    localStorage.setItem("finance_auth_user", JSON.stringify(payload.user));
    setAuthToken(payload.token);
    setUser(payload.user);
    setOverview(null);
  }

  function signOut() {
    clearSavedAuth();
    setAuthToken("");
    setUser(null);
    setOverview(null);
  }

  if (!authToken || !user) {
    return <AuthPage error={authError} onSubmit={submitAuth} />;
  }

  if (!overview) {
    return <main className="loadingShell">{error ? <ErrorMessage message={error} /> : <p>Loading finance dashboard...</p>}</main>;
  }

  const metrics = getMetrics(overview);
  const title = pages.find(item => item.id === page)?.label ?? "Home";

  return (
    <div className="appFrame">
      <aside className="sidebar">
        <div className="household">
          <strong>Aalsi</strong>
        </div>
        <div className="netWorthMini">
          <span>Net worth</span>
          <strong>{formatMoney(metrics.monthlyIncome - metrics.debtTotal, "USD")}</strong>
        </div>
        <nav className="navList" aria-label="Primary">
          {pages.map(item => (
            <a className={page === item.id ? "active" : ""} href={`#${item.id}`} key={item.id}>{item.label}</a>
          ))}
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <TopTabs activeTab={activeTab} page={page} />
          </div>
          <div className="actions">
            <label className="search" aria-label="Search transactions"><span>Search transactions, merchants...</span></label>
            <button className="primaryButton" onClick={() => setUploadOpen(true)} type="button">+ Add</button>
            <div className="profileMenuWrap">
              <button className="avatar small profileButton" onClick={() => setProfileOpen(open => !open)} title="Profile actions" type="button">{getInitial(user)}</button>
              {profileOpen ? <ProfileMenu onClose={() => setProfileOpen(false)} onSignOut={signOut} user={user} /> : null}
            </div>
          </div>
        </header>

        <section className="workspace">
          {error ? <ErrorMessage message={error} /> : null}
          {page === "spend" ? <QuickAdd form={form} setForm={setForm} submitTransaction={submitTransaction} /> : null}
          <PageContent activeTab={activeTab} authToken={authToken} metrics={metrics} overview={overview} page={page} selectedMerchant={selectedMerchant} />
        </section>
      </main>
      {uploadOpen ? <UploadModal authToken={authToken} onClose={() => setUploadOpen(false)} onImported={loadOverview} /> : null}
    </div>
  );
}

function AuthPage({ error, onSubmit }: { error: string | null; onSubmit: (mode: "login" | "register", values: { email: string; password: string; name: string }) => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [values, setValues] = useState({ email: "", password: "", name: "" });
  const isRegister = mode === "register";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit(mode, values);
  }

  return (
    <main className="authShell">
      <section className="authCard">
        <div className="authBrand">
          <span>Aalsi</span>
        </div>
        <h1>{isRegister ? "Create your secure account" : "Sign in to your finances"}</h1>
        <p>For people who are lazy about managing money—we'll do it for you.</p>
        {error ? <ErrorMessage message={error} /> : null}
        <form className="authForm" onSubmit={submit}>
          {isRegister ? <label>Name<input required value={values.name} onChange={event => setValues({ ...values, name: event.target.value })} placeholder="Your name" /></label> : null}
          <label>Email<input required type="email" value={values.email} onChange={event => setValues({ ...values, email: event.target.value })} placeholder="you@example.com" /></label>
          <label>Password<input required minLength={8} type="password" value={values.password} onChange={event => setValues({ ...values, password: event.target.value })} placeholder="At least 8 characters" /></label>
          <button className="primaryButton" type="submit">{isRegister ? "Register" : "Login"}</button>
        </form>
        <button className="textButton" onClick={() => setMode(isRegister ? "login" : "register")} type="button">
          {isRegister ? "Already registered? Login" : "First time user? Register"}
        </button>
      </section>
    </main>
  );
}

function ProfileMenu({ onClose, onSignOut, user }: { onClose: () => void; onSignOut: () => void; user: AuthUser }) {
  function navigate(hash: string) {
    window.location.hash = hash;
    onClose();
  }

  function exportProfile() {
    const blob = new Blob([JSON.stringify({ user, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "aalsi-profile.json";
    link.click();
    URL.revokeObjectURL(url);
    onClose();
  }

  return (
    <div className="profileMenu">
      <div className="profileMenuHeader">
        <strong>{user.name}</strong>
        <span>{user.email}</span>
      </div>
      <button onClick={() => navigate("#home/overview")} type="button">Dashboard</button>
      <button onClick={() => navigate("#connections/overview")} type="button">Connections</button>
      <button onClick={() => navigate("#privacy/consent")} type="button">Privacy controls</button>
      <button onClick={exportProfile} type="button">Export profile</button>
      <button className="dangerAction" onClick={onSignOut} type="button">Sign out</button>
    </div>
  );
}

function UploadModal({ authToken, onClose, onImported }: { authToken: string; onClose: () => void; onImported: () => Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [receiptText, setReceiptText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);

    if (files.length === 0) {
      setUploadError("Choose at least one screenshot, PDF, receipt, statement, or supporting file.");
      return;
    }

    setUploading(true);
    setUploadStatus("Reading files...");
    const payloadFiles = await Promise.all(files.map(async file => ({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file),
      extractedText: [receiptText, await extractTextFromFile(file, setUploadStatus)].filter(Boolean).join("\n")
    })));

    setUploadStatus("Importing and segregating...");
    const response = await fetch(`${apiBase}/api/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
      body: JSON.stringify({ files: payloadFiles })
    });
    const payload = await response.json() as ImportResult & { error?: string };
    setUploading(false);
    setUploadStatus("");

    if (!response.ok) {
      setUploadError(payload.error ?? "Could not import files.");
      return;
    }

    setResult(payload);
    await onImported();
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Import financial documents">
      <section className="uploadModal">
        <div className="modalHeader">
          <div className="titleWithInfo"><h2>Add financial documents</h2><InfoTip text="Upload screenshots, PDFs, receipts, statements, CSVs, or supporting files. The app will segregate them into finance areas." /></div>
          <button className="iconButton" onClick={onClose} type="button">x</button>
        </div>
        {uploadError ? <ErrorMessage message={uploadError} /> : null}
        <form className="uploadForm" onSubmit={submit}>
          <label className="dropZone">
            <strong>Select files</strong>
            <span>Images, PDFs, CSVs, text</span>
            <input multiple accept="image/*,.pdf,.csv,.txt,.json,.xlsx,.xls" onChange={event => setFiles(Array.from(event.target.files ?? []))} type="file" />
          </label>
          <label className="receiptTextField">
            <span className="labelWithInfo">Receipt text or OCR output <InfoTip text="Scanned PDFs and screenshots need OCR text here until automatic OCR is added. The app will not guess amounts." /></span>
            <textarea value={receiptText} onChange={event => setReceiptText(event.target.value)} placeholder="Paste OCR text here" />
          </label>
          {files.length > 0 ? <SimpleRows rows={files.map(file => [file.name, `${classifyUploadFile(file)} - ${file.type || "unknown"} - ${Math.round(file.size / 1024)} KB`])} /> : null}
          {uploadStatus ? <div className="notice">{uploadStatus}</div> : null}
          <button className="primaryButton" disabled={uploading} type="submit">{uploading ? "Working..." : "Import and segregate"}</button>
        </form>
        {result ? (
          <div className="importResult">
            <h3>{result.importedCount} transaction{result.importedCount === 1 ? "" : "s"} created</h3>
            <SimpleRows rows={result.files.map(file => [file.fileName, file.needsReview ? `Needs OCR review - ${file.reviewMessage ?? "No readable text found"}` : `${file.documentType} - ${file.detectedCategory} - ${file.detectedMerchant}`])} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PageContent({ activeTab, authToken, metrics, overview, page, selectedMerchant }: { activeTab: PageTab; authToken: string; metrics: Metrics; overview: Overview; page: Page; selectedMerchant: string }) {
  switch (page) {
    case "spend":
      return <SpendPage overview={overview} selectedMerchant={selectedMerchant} tab={activeTab} />;
    case "insights":
      return <InsightsPage metrics={metrics} overview={overview} tab={activeTab} />;
    case "income":
      return <IncomePage metrics={metrics} overview={overview} tab={activeTab} />;
    case "debt":
      return <DebtPage overview={overview} tab={activeTab} />;
    case "cards":
      return <CardsPage tab={activeTab} />;
    case "investments":
      return <InvestmentsPage metrics={metrics} tab={activeTab} />;
    case "goals":
      return <GoalsPage metrics={metrics} tab={activeTab} />;
    case "connections":
      return <ConnectionsPage authToken={authToken} tab={activeTab} />;
    case "privacy":
      return <PrivacyPage tab={activeTab} />;
    default:
      return <HomePage metrics={metrics} overview={overview} tab={activeTab} />;
  }
}

function HomePage({ metrics, overview, tab }: { metrics: Metrics; overview: Overview; tab: PageTab }) {
  const primaryDebt = overview.debts[0];
  const topTransaction = overview.transactions[0];

  if (tab === "goals") {
    return <GoalsPage metrics={metrics} tab="active" />;
  }

  if (tab === "recommendations") {
    return <InsightsPage metrics={metrics} overview={overview} tab="overview" />;
  }

  return (
    <section className="homeMinimal">
      <article className="homeHero">
        <div>
          <span className="pill">Today</span>
          <h2>Aalsi</h2>
          <h3>For people who are lazy about managing money—we'll do it for you.</h3>
        </div>
        <div className="healthDial"><strong>72</strong><span>/100</span></div>
      </article>

      <ReminderCarousel metrics={metrics} overview={overview} primaryDebt={primaryDebt} />

      <section className="homeStats">
        <MiniStat label="Safe to spend" value={formatMoney(metrics.safeToSpend, "USD")} tone="mint" />
        <MiniStat label="Income" value={formatMoney(metrics.monthlyIncome, "USD")} />
        <MiniStat label="Debt" value={formatMoney(metrics.debtTotal, "USD")} />
      </section>

      <section className="homeFocusGrid">
        <article className="card focusCard">
          <CardHeader label="Latest activity" />
          {topTransaction ? <ActivityList transactions={[topTransaction]} /> : <p>No transactions yet.</p>}
        </article>
        <article className="card focusCard">
          <CardHeader label="Next best action" />
          <p>{overview.insights[0]?.action ?? "Upload a receipt or statement to get personalized recommendations."}</p>
        </article>
      </section>
    </section>
  );
}

function ReminderCarousel({ metrics, overview, primaryDebt }: { metrics: Metrics; overview: Overview; primaryDebt: DebtWithPayoff | undefined }) {
  const latest = overview.transactions[0];
  const reminders = [
    primaryDebt ? { label: "Payment due", title: primaryDebt.name, detail: `${formatMoney(primaryDebt.minimumPayment, primaryDebt.currency)} due on day ${primaryDebt.dueDayOfMonth}` } : { label: "Debt", title: "No debt reminder", detail: "Add a loan to track due dates." },
    { label: "Safe spend", title: formatMoney(metrics.safeToSpend, "USD"), detail: "Available after tracked spending." },
    latest ? { label: "Recent charge", title: latest.merchant, detail: `${formatMoney(latest.amount, latest.currency)} in ${latest.category}` } : { label: "Activity", title: "No recent charges", detail: "Upload a document to begin." },
    { label: "Savings rate", title: `${metrics.savingsRate}%`, detail: "Based on income minus tracked spend." }
  ];

  return (
    <div className="reminderCarousel" aria-label="Rotating reminders">
      <div className="reminderTrack">
        {[...reminders, ...reminders].map((reminder, index) => (
          <article className="reminderAd" key={`${reminder.label}-${index}`}>
            <span>{reminder.label}</span>
            <strong>{reminder.title}</strong>
            <small>{reminder.detail}</small>
          </article>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "mint" }) {
  return <article className={`miniStat ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong></article>;
}

function SpendPage({ overview, selectedMerchant, tab }: { overview: Overview; selectedMerchant: string; tab: PageTab }) {
  const content = {
    transactions: <article className="card wideCard"><CardHeader label="Transactions" /><TransactionTable transactions={overview.transactions} /></article>,
    merchants: <article className="card wideCard"><CardHeader label="Merchant intelligence" /><MerchantCard overview={overview} selectedMerchant={selectedMerchant} /></article>,
    items: <article className="card wideCard"><CardHeader label="Item and product-type intelligence" /><ItemIntelligence overview={overview} /></article>,
    recurring: <article className="card wideCard"><CardHeader label="Recurring and fixed expenses" /><RecurringIntelligence overview={overview} /></article>
  }[tab];

  return (
    <section className="pageStack">
      <SectionIntro title="Expense and merchant intelligence" text="Track fixed costs, variable spending, merchants, item types, and recurring patterns from statements and receipts." />
      <div className="dashboardGrid">
        {tab === "transactions" ? <article className="card budgetCard"><CardHeader label="Categories" /><CategoryList overview={overview} /></article> : null}
        {content}
      </div>
    </section>
  );
}

function InsightsPage({ metrics, overview, tab }: { metrics: Metrics; overview: Overview; tab: PageTab }) {
  if (tab === "report") {
    return (
      <section className="pageStack">
        <SectionIntro title="Monthly AI report" text="A short summary of what changed across income, expenses, merchants, debt, and goals." />
        <article className="card wideCard"><CardHeader label="This month" /><SimpleRows rows={[["Food and shopping", "Review repeat merchant and item patterns"], ["Debt", `${formatMoney(metrics.debtTotal, "USD")} outstanding`], ["Savings rate", `${metrics.savingsRate}% after tracked USD spending`], ["Next action", "Pick one goal before accepting AI recommendations"]]} /></article>
      </section>
    );
  }

  if (tab === "affordability") {
    return (
      <section className="pageStack">
        <SectionIntro title="Can I afford this?" text="The assistant weighs surplus, upcoming obligations, debt, goals, and current spending trend." />
        <article className="card wideCard"><CardHeader label="Purchase readiness" /><h2>Review purchases above {formatMoney(Math.max(metrics.safeToSpend * 0.25, 100), "USD")}</h2><p>Technically affordable purchases can still hurt savings rate or delay debt payoff.</p><Evidence items={["Safe-to-spend", "Debt balance", "Savings rate", "Recent transactions"]} /></article>
      </section>
    );
  }

  if (tab === "evidence") {
    return (
      <section className="pageStack">
        <SectionIntro title="Evidence and confidence" text="Every AI recommendation should show the data behind it." />
        <article className="card wideCard"><CardHeader label="Evidence model" /><Evidence items={["What happened", "Why it matters", "Data used", "Confidence", "Suggested action"]} /></article>
      </section>
    );
  }

  return (
    <section className="pageStack">
      <SectionIntro title="Explainable AI recommendations" text="Each recommendation should show what happened, why it matters, confidence, evidence, and a practical action." />
      <div className="insightList">
        {overview.insights.map(insight => <EvidenceInsight insight={insight} key={insight.id} />)}
        <article className="card wideCard">
          <CardHeader label="Can I afford this?" />
          <h2>Purchase readiness</h2>
          <p>Based on income, spending, debt, and current surplus, purchases above {formatMoney(Math.max(metrics.safeToSpend * 0.25, 100), "USD")} should be reviewed before buying.</p>
          <Evidence items={["Monthly income", "Current spending", "Debt obligations", "Savings rate"]} />
        </article>
      </div>
    </section>
  );
}

function IncomePage({ metrics, overview, tab }: { metrics: Metrics; overview: Overview; tab: PageTab }) {
  if (tab === "sources") {
    return <section className="pageStack"><SectionIntro title="Income sources" text="Track salary deposits and other incoming money separately." /><article className="card wideCard"><CardHeader label="Sources" /><SimpleRows rows={overview.salary.map(income => [income.employer, formatMoney(income.netAmount, income.currency)])} /></article></section>;
  }

  if (tab === "cashflow") {
    return <section className="pageStack"><SectionIntro title="Cash flow" text="Compare incoming money against expenses to estimate surplus or deficit." /><div className="dashboardGrid"><MetricCard label="Income" value={formatMoney(metrics.monthlyIncome, "USD")} text="Tracked income this period." /><MetricCard label="Outflow" value={formatMoney(metrics.usdSpend, "USD")} text="Tracked USD spending this period." /><MetricCard label="Surplus" value={formatMoney(metrics.safeToSpend, "USD")} text="Estimated income left after spending." /></div></section>;
  }

  return (
    <section className="pageStack">
      <SectionIntro title="Salary and cash flow" text="Understand deposits, surplus, savings rate, fixed expenses, and income consistency." />
      <div className="dashboardGrid">
        <MetricCard label="Monthly income" value={formatMoney(metrics.monthlyIncome, "USD")} text="Tracked from salary and income records." />
        <MetricCard label="Savings rate" value={`${metrics.savingsRate}%`} text="Income left after tracked USD spending." />
        <article className="card wideCard"><CardHeader label="Income sources" /><SimpleRows rows={overview.salary.map(income => [income.employer, formatMoney(income.netAmount, income.currency)])} /></article>
      </div>
    </section>
  );
}

function DebtPage({ overview, tab }: { overview: Overview; tab: PageTab }) {
  const debtTotal = overview.debts.reduce((sum, debt) => sum + debt.balance, 0);

  if (tab === "loans") {
    return <section className="pageStack"><SectionIntro title="Loans" text="Loan-specific tracking for balances, APR, due dates, and repayment progress." /><article className="card wideCard"><CardHeader label="Loans" /><DebtRows debts={overview.debts} /></article></section>;
  }

  if (tab === "payoff") {
    return <section className="pageStack"><SectionIntro title="Payoff planning" text="Estimate payoff timing and show where extra payments can help." /><article className="card wideCard"><CardHeader label="Payoff estimate" /><SimpleRows rows={overview.debts.map(debt => [debt.name, `${debt.payoffMonths ?? "N/A"} months at current payment pattern`])} /></article></section>;
  }

  return (
    <section className="pageStack">
      <SectionIntro title="Debt and loan management" text="Track balances, APR, due dates, payment progress, and payoff estimates separately from credit cards." />
      <div className="dashboardGrid">
        <MetricCard label="Total debt" value={formatMoney(debtTotal, "USD")} text={`Across ${overview.debts.length} account${overview.debts.length === 1 ? "" : "s"}.`} />
        <article className="card wideCard"><CardHeader label="Loans" /><DebtRows debts={overview.debts} /></article>
      </div>
    </section>
  );
}

function CardsPage({ tab }: { tab: PageTab }) {
  const copy = tab === "utilization" ? "Track card-wise utilization, outstanding balance, and interest risk." : tab === "due-dates" ? "Track statement due dates, minimum payments, and missed-payment risk." : "Track card-wise usage, utilization, statement balances, due dates, minimum payments, interest risk, and subscription charges.";
  return (
    <EmptyModule action="Connect a card" href="#connections/banks-cards" title="Credit card management" text={copy} />
  );
}

function InvestmentsPage({ metrics, tab }: { metrics: Metrics; tab: PageTab }) {
  const ready = metrics.debtTotal === 0 && metrics.savingsRate >= 15;

  if (tab === "india") {
    return <section className="pageStack"><SectionIntro title="India market research" text="Country-specific research belongs here, separated from personal recommendations." /><article className="card wideCard"><CardHeader label="Research areas" /><SimpleRows rows={[["Mutual funds", "Category-level research, not stock tips"], ["Fixed deposits", "Lower-volatility options for shorter goals"], ["Gold and bonds", "Diversification research for India context"]]} /></article></section>;
  }

  if (tab === "readiness") {
    return <section className="pageStack"><SectionIntro title="Investment readiness" text="Checks debt, savings rate, surplus, emergency fund, and risk capacity before investing." /><MetricCard label="Readiness" value={ready ? "Ready" : "Cautious"} text={ready ? "Low debt and healthy surplus support investing." : "Debt, emergency fund, or savings rate should be reviewed first."} /></section>;
  }

  return (
    <section className="pageStack">
      <SectionIntro title="India investment readiness" text="This is not a stock-tip module. It checks whether the user's current financial standing supports investment risk." />
      <div className="dashboardGrid">
        <MetricCard label="Readiness" value={ready ? "Ready" : "Cautious"} text={ready ? "Low debt and healthy surplus support investing." : "Debt, emergency fund, or savings rate should be reviewed first."} />
        <article className="card wideCard"><CardHeader label="Guidance" /><SimpleRows rows={[["First priority", metrics.debtTotal > 0 ? "Review high-interest debt before aggressive investing" : "Build a diversified plan"], ["Short-term goals", "Prefer lower-volatility options"], ["Long-term goals", "SIP-style category research can fit stable surplus"]]} /></article>
      </div>
    </section>
  );
}

function GoalsPage({ metrics, tab }: { metrics: Metrics; tab: PageTab }) {
  if (tab === "progress") {
    return <section className="pageStack"><SectionIntro title="Goal progress" text="Track progress using spending, surplus, debt, and merchant behavior." /><div className="dashboardGrid"><MetricCard label="Savings capacity" value={formatMoney(metrics.safeToSpend, "USD")} text="Current estimated surplus." /><MetricCard label="Savings rate" value={`${metrics.savingsRate}%`} text="After tracked USD expenses." /></div></section>;
  }

  return (
    <section className="pageStack">
      <SectionIntro title="Goals layer" text="Recommendations become useful when they are tied to a specific user goal." />
      <div className="dashboardGrid">
        <GoalCard title="Save $500/month" text={`Current estimated safe-to-spend is ${formatMoney(metrics.safeToSpend, "USD")}.`} />
        <GoalCard title="Pay off debt" text="Prioritize extra payments only after fixed expenses and emergency buffer are covered." />
        <GoalCard title="Reduce impulse spending" text="Use merchant and item patterns to find repeat purchases worth reviewing." />
      </div>
    </section>
  );
}

function ConnectionsPage({ authToken, tab }: { authToken: string; tab: PageTab }) {
  const [connections, setConnections] = useState<ConnectionState[]>([]);
  const [plaidConfigured, setPlaidConfigured] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadConnections() {
    const response = await fetch(`${apiBase}/api/connections`, { headers: authHeaders(authToken) });
    if (!response.ok) {
      setMessage("Unable to load connections.");
      return;
    }
    const payload = await response.json() as { plaidConfigured: boolean; connections: ConnectionState[] };
    setConnections(payload.connections);
    setPlaidConfigured(payload.plaidConfigured);
  }

  useEffect(() => {
    void loadConnections();
  }, [authToken]);

  async function connectPlaid() {
    setMessage(null);
    const response = await fetch(`${apiBase}/api/connections/plaid/link-token`, {
      method: "POST",
      headers: authHeaders(authToken)
    });
    const payload = await response.json() as { error?: string; message?: string };
    setMessage(payload.error ?? payload.message ?? "Plaid Link is ready.");
  }

  async function disconnect(id: string) {
    const response = await fetch(`${apiBase}/api/connections/${id}/disconnect`, {
      method: "POST",
      headers: authHeaders(authToken)
    });
    if (response.ok) {
      const payload = await response.json() as { connections: ConnectionState[] };
      setConnections(payload.connections);
    }
  }

  const visibleConnections = tab === "banks-cards"
    ? connections.filter(connection => connection.id === "banks-cards")
    : tab === "imports"
      ? connections.filter(connection => ["manual-imports", "cloud-storage", "email-receipts"].includes(connection.id))
      : connections;

  return (
    <section className="pageStack">
      <SectionIntro title="Connections" text="Connect apps and data sources once, then let Aalsi track transactions, receipts, merchants, and item details automatically." />
      {message ? <div className="notice">{message}</div> : null}
      {!plaidConfigured ? <div className="notice">Plaid is ready in the UI, but live bank linking needs API credentials in the server environment.</div> : null}
      <div className="connectionsGrid">
        {visibleConnections.map(connection => (
          <ConnectionCard connection={connection} key={connection.id} onConnectPlaid={connectPlaid} onDisconnect={disconnect} />
        ))}
      </div>
    </section>
  );
}

function ConnectionCard({ connection, onConnectPlaid, onDisconnect }: { connection: ConnectionState; onConnectPlaid: () => Promise<void>; onDisconnect: (id: string) => Promise<void> }) {
  const statusLabel = connection.status === "connected" ? "Connected" : connection.status === "needs_config" ? "Needs setup" : "Not connected";

  return (
    <article className="connectionCard">
      <div className="connectionTop">
        <div>
          <span>{connection.category}</span>
          <h2>{connection.name}</h2>
        </div>
        <span className={`statusPill ${connection.status}`}>{statusLabel}</span>
      </div>
      <SimpleRows rows={[
        ["Last sync", connection.lastSync ? new Date(connection.lastSync).toLocaleString() : "Never"],
        ["Data used", connection.dataUsed.join(", ")],
        ["Permission", connection.permissionScope]
      ]} />
      <div className="connectionActions">
        {connection.id === "banks-cards" ? <button className="primaryButton" onClick={() => void onConnectPlaid()} type="button">Connect Plaid</button> : <button className="primaryButton" type="button">Connect</button>}
        <button className="textButton" onClick={() => void onDisconnect(connection.id)} type="button">Disconnect</button>
        <InfoTip text={connection.privacyNote} />
      </div>
    </article>
  );
}

function PrivacyPage({ tab }: { tab: PageTab }) {
  if (tab === "redaction") {
    return <section className="pageStack"><SectionIntro title="Redaction" text="PII and sensitive data should be removed before external LLM calls." /><div className="dashboardGrid"><PrivacyToggle label="PII redaction" text="Names, account details, and identifiers are stripped from model summaries." /><PrivacyToggle label="Sensitive data classifier" text="Blocks credentials, security codes, private keys, and raw confidential data." /></div></section>;
  }

  if (tab === "audit") {
    return <section className="pageStack"><SectionIntro title="Audit logs" text="Users should see what data supported every recommendation." /><article className="card wideCard"><CardHeader label="Audit fields" /><SimpleRows rows={[["Recommendation", "What the app suggested"], ["Evidence", "Transactions, merchants, goals, or documents used"], ["Model path", "Rules, analytics, RAG, or LLM"], ["Consent", "Which permission allowed the analysis"]]} /></article></section>;
  }

  return (
    <section className="pageStack">
      <SectionIntro title="Privacy and consent" text="Sensitive finance, health, and personal context should be opt-in, auditable, redactable, and removable." />
      <div className="dashboardGrid">
        <PrivacyToggle label="Private mode" text="Prefer local processing and avoid external LLM calls." />
        <PrivacyToggle label="Health-aware analysis" text="Off by default. Uses only user-provided preferences." />
        <PrivacyToggle label="LLM redaction" text="Remove PII before sending summaries to cloud models." />
        <PrivacyToggle label="Audit log" text="Show what data supported every recommendation." />
      </div>
    </section>
  );
}

function QuickAdd({ form, setForm, submitTransaction }: { form: { amount: string; merchant: string; category: string; subcategory: string; currency: string; date: string }; setForm: React.Dispatch<React.SetStateAction<{ amount: string; merchant: string; category: string; subcategory: string; currency: string; date: string }>>; submitTransaction: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className="quickAdd" onSubmit={submitTransaction}>
      <button className="primaryButton" type="submit">Log</button>
      <input required type="number" min="0" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} placeholder="Amount" />
      <input required value={form.merchant} onChange={event => setForm({ ...form, merchant: event.target.value })} placeholder="Merchant" />
      <select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}><option>Food</option><option>Shopping</option><option>Debt</option><option>Transfer</option><option>Housing</option><option>Travel</option></select>
      <select value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}><option>USD</option><option>INR</option></select>
    </form>
  );
}

function TopTabs({ activeTab, page }: { activeTab: PageTab; page: Page }) {
  return (
    <div className="tabs">
      {pageTabs[page].map(tab => <a className={activeTab === tab.id ? "active" : ""} href={`#${page}/${tab.id}`} key={tab.id}>{tab.label}</a>)}
    </div>
  );
}

function CardHeader({ label }: { label: string }) {
  return <div className="cardHeader"><span>{label}</span><button type="button" aria-label={`${label} options`}>...</button></div>;
}

function BudgetPreview({ overview }: { overview: Overview }) {
  return <div className="budgetList">{Object.entries(budgetLimits).slice(0, 5).map(([category, limit]) => <BudgetLine category={category} key={category} limit={limit} spent={overview.categorySummary[category] ?? 0} />)}</div>;
}

function BudgetLine({ category, limit, spent }: { category: string; limit: number; spent: number }) {
  const progress = Math.min((spent / limit) * 100, 100);
  return <div className="budgetLine"><div><span>{category}</span><b>{formatMoney(spent, "USD")} / {formatMoney(limit, "USD")}</b></div><div className="progress"><span style={{ width: `${progress}%` }} /></div></div>;
}

function ActivityList({ transactions }: { transactions: Transaction[] }) {
  return <div className="activityList">{transactions.map(transaction => <div className="activityRow" key={transaction.id}><span className="initial">{transaction.merchant.slice(0, 1)}</span><span><b>{transaction.merchant}</b><small>{transaction.category}{transaction.subcategory ? ` - ${transaction.subcategory}` : ""}</small></span><strong>-{formatMoney(transaction.amount, transaction.currency)}</strong></div>)}</div>;
}

function CategoryList({ overview }: { overview: Overview }) {
  return <SimpleRows rows={Object.entries(overview.categorySummary).map(([category, amount]) => [category, formatMoney(amount, category === "Debt" ? "INR" : "USD")])} />;
}

function MerchantCard({ overview, selectedMerchant }: { overview: Overview; selectedMerchant: string }) {
  const [query, setQuery] = useState("");
  const merchantTotals = getMerchantTotals(overview.transactions);
  const filteredMerchants = merchantTotals.filter(merchant => merchant.merchant.toLowerCase().includes(query.trim().toLowerCase()) || merchant.topCategory.toLowerCase().includes(query.trim().toLowerCase()));
  const activeMerchant = selectedMerchant || filteredMerchants[0]?.merchant || merchantTotals[0]?.merchant || overview.merchantSummary.merchant;
  const merchantTransactions = overview.transactions.filter(transaction => transaction.merchant.toLowerCase() === activeMerchant.toLowerCase());
  const merchantTotal = merchantTransactions.reduce((sum, transaction) => sum + (transaction.currency === "USD" ? transaction.amount : 0), 0);
  const averageSpend = merchantTransactions.length ? merchantTotal / merchantTransactions.length : 0;
  const itemRows = getTopProducts(merchantTransactions).map(item => [item.category, `${item.name} - ${formatMoney(item.total, "USD")}${item.count > 1 ? ` - ${item.count}x` : ""}`]);
  const categoryRows = getCategoryRows(merchantTransactions).map(row => [row.category, formatMoney(row.total, "USD")]);

  return (
    <div className="merchantLayout">
      <div>
        <h2>Merchants</h2>
        <div className="merchantSearch"><input aria-label="Search merchants" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find merchant..." type="search" /></div>
        <div className="merchantList">
          {filteredMerchants.map(merchant => (
            <a className={activeMerchant === merchant.merchant ? "active" : ""} href={`#spend/merchants/${encodeURIComponent(merchant.merchant)}`} key={merchant.merchant}>
              <span><b>{merchant.merchant}</b><small>{merchant.topCategory} - {merchant.count}x</small></span>
              <strong>{formatMoney(merchant.total, "USD")}</strong>
            </a>
          ))}
        </div>
      </div>
      <div>
        <div className="merchantSummaryHero">
          <span>{activeMerchant.slice(0, 2)}</span>
          <div><h2>{activeMerchant}</h2><p>{merchantTransactions.length} purchase{merchantTransactions.length === 1 ? "" : "s"} - average {formatMoney(averageSpend, "USD")}</p></div>
          <strong>{formatMoney(merchantTotal, "USD")}</strong>
        </div>
        <div className="merchantDetailGrid">
          <section><h3>Spending by category</h3><SimpleRows rows={categoryRows.length > 0 ? categoryRows : [["No categories", "No spending found"]]} /></section>
          <section><h3>Top products</h3><SimpleRows rows={itemRows.length > 0 ? itemRows : [["No item lines", "Upload receipt text or image OCR to split products"]]} /></section>
        </div>
        <h3>Transactions</h3>
        <TransactionTable transactions={merchantTransactions} />
      </div>
    </div>
  );
}

function ItemIntelligence({ overview }: { overview: Overview }) {
  const items = Object.entries(overview.merchantSummary.contributions).map(([item, amount]) => [item, `${formatMoney(amount, "USD")} at ${overview.merchantSummary.merchant}`]);
  return <><h2>What you bought</h2><p>Item-level views use receipt lines, merchant metadata, or manual transaction detail when available.</p><SimpleRows rows={items.length > 0 ? items : [["No items yet", "Upload receipts to detect product types"]]} /></>;
}

function RecurringIntelligence({ overview }: { overview: Overview }) {
  const rows = overview.debts.map(debt => [debt.name, `${formatMoney(debt.minimumPayment, debt.currency)} monthly payment - due day ${debt.dueDayOfMonth}`]);
  return <><h2>Fixed expenses and recurring obligations</h2><p>Recurring detection separates predictable commitments from flexible spending.</p><SimpleRows rows={rows.length > 0 ? rows : [["No recurring payments detected", "Upload statements to find subscriptions and bills"]]} /></>;
}

function TransactionTable({ transactions }: { transactions: Transaction[] }) {
  return <div className="tableList">{transactions.map(transaction => <div className="tableRow" key={transaction.id}><span>{transaction.date}</span><b>{transaction.merchant}</b><span>{transaction.category}</span><strong>{formatMoney(transaction.amount, transaction.currency)}</strong></div>)}</div>;
}

function EvidenceInsight({ insight }: { insight: Insight }) {
  return <article className="card wideCard"><CardHeader label={insight.severity} /><h2>{insight.title}</h2><p>{insight.body}</p>{insight.action ? <small>{insight.action}</small> : null}<Evidence items={["Recent transactions", "Merchant/category totals", "Current goal context", "Confidence: medium"]} /></article>;
}

function Evidence({ items }: { items: string[] }) {
  return <div className="evidence"><b>Evidence</b>{items.map(item => <span key={item}>{item}</span>)}</div>;
}

function DebtRows({ debts }: { debts: DebtWithPayoff[] }) {
  return <SimpleRows rows={debts.map(debt => [debt.name, `${formatMoney(debt.balance, debt.currency)} - ${debt.annualInterestRate}% APR - due day ${debt.dueDayOfMonth}`])} />;
}

function SimpleRows({ rows }: { rows: string[][] }) {
  return <div className="simpleRows">{rows.map(([label, value]) => <div className="simpleRow" key={`${label}-${value}`}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function SectionIntro({ title, text }: { title: string; text: string }) {
  return <div className="sectionIntro"><h2>{title}</h2><InfoTip text={text} /></div>;
}

function InfoTip({ text }: { text: string }) {
  return <span className="infoTip" aria-label={text} data-tooltip={text} tabIndex={0}>i</span>;
}

function MetricCard({ label, value, text }: { label: string; value: string; text: string }) {
  return <article className="card calmPanel"><CardHeader label={label} /><strong>{value}</strong><p>{text}</p></article>;
}

function GoalCard({ title, text }: { title: string; text: string }) {
  return <article className="card"><CardHeader label="Goal" /><h2>{title}</h2><p>{text}</p></article>;
}

function PrivacyToggle({ label, text }: { label: string; text: string }) {
  return <article className="card"><CardHeader label="Control" /><h2>{label}</h2><p>{text}</p><span className="pill">User controlled</span></article>;
}

function EmptyModule({ action, href, title, text }: { action: string; href?: string; title: string; text: string }) {
  return (
    <section className="emptyModule">
      <div className="titleWithInfo"><h2>{title}</h2><InfoTip text={text} /></div>
      {href ? <a className="primaryButton linkButton" href={href}>{action}</a> : <button className="primaryButton" type="button">{action}</button>}
    </section>
  );
}

function Bars() {
  return <div className="bars" aria-hidden="true"><span /><span /><span /><span /><span /></div>;
}

function ErrorMessage({ message }: { message: string }) {
  return <div className="error">{message}</div>;
}

function getMetrics(overview: Overview): Metrics {
  const usdSpend = overview.transactions.filter(transaction => transaction.currency === "USD").reduce((sum, transaction) => sum + transaction.amount, 0);
  const inrSpend = overview.transactions.filter(transaction => transaction.currency === "INR").reduce((sum, transaction) => sum + transaction.amount, 0);
  const monthlyIncome = overview.salary.reduce((sum, income) => sum + income.netAmount, 0);
  const debtTotal = overview.debts.reduce((sum, debt) => sum + debt.balance, 0);
  const safeToSpend = Math.max(monthlyIncome - usdSpend, 0);
  const savingsRate = monthlyIncome > 0 ? Math.round(((monthlyIncome - usdSpend) / monthlyIncome) * 100) : 0;
  return { usdSpend, inrSpend, monthlyIncome, debtTotal, safeToSpend, savingsRate };
}

function getInitial(user: AuthUser) {
  return (user.name || user.email || "A").slice(0, 1).toUpperCase();
}

function getPageFromHash(): Page {
  const hash = window.location.hash.replace("#", "").split("/")[0] as Page;
  return pages.some(page => page.id === hash) ? hash : "home";
}

function getTabFromHash(page: Page): PageTab {
  const tab = window.location.hash.replace("#", "").split("/")[1];
  return pageTabs[page].some(item => item.id === tab) ? tab : pageTabs[page][0].id;
}

function getMerchantFromHash() {
  const merchant = window.location.hash.replace("#", "").split("/")[2];
  return merchant ? decodeURIComponent(merchant) : "";
}

function getMerchantTotals(transactions: Transaction[]) {
  const totals = transactions.reduce<Record<string, { total: number; count: number; categories: Record<string, number> }>>((summary, transaction) => {
    const entry = summary[transaction.merchant] ?? { total: 0, count: 0, categories: {} };
    entry.total += transaction.currency === "USD" ? transaction.amount : 0;
    entry.count += 1;
    entry.categories[transaction.category] = (entry.categories[transaction.category] ?? 0) + 1;
    summary[transaction.merchant] = entry;
    return summary;
  }, {});

  return Object.entries(totals).map(([merchant, details]) => ({
    merchant,
    total: details.total,
    count: details.count,
    topCategory: Object.entries(details.categories).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Uncategorized"
  })).sort((a, b) => b.total - a.total);
}

function getCategoryRows(transactions: Transaction[]) {
  const totals = transactions.reduce<Record<string, number>>((summary, transaction) => {
    summary[transaction.category] = (summary[transaction.category] ?? 0) + (transaction.currency === "USD" ? transaction.amount : 0);
    return summary;
  }, {});

  return Object.entries(totals).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

function getTopProducts(transactions: Transaction[]) {
  const products = transactions.flatMap(transaction => transaction.items.map(item => ({
    name: item.name,
    category: item.itemCategory ?? item.subcategory ?? item.category,
    amount: transaction.currency === "USD" ? item.amount : 0
  })));
  const totals = products.reduce<Record<string, { category: string; total: number; count: number }>>((summary, product) => {
    const entry = summary[product.name] ?? { category: product.category, total: 0, count: 0 };
    entry.total += product.amount;
    entry.count += 1;
    summary[product.name] = entry;
    return summary;
  }, {});

  return Object.entries(totals).map(([name, details]) => ({ name, ...details })).sort((a, b) => b.total - a.total);
}

function classifyUploadFile(file: File) {
  return /\.(csv|xlsx|xls)$/i.test(file.name) || ["text/csv", "application/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(file.type)
    ? "Spreadsheet mapping"
    : "Document OCR";
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function clearSavedAuth() {
  localStorage.removeItem("finance_auth_token");
  localStorage.removeItem("finance_auth_user");
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fileToText(file: File) {
  if (!/^text\//.test(file.type) && !/\.(csv|txt|json)$/i.test(file.name)) {
    return Promise.resolve("");
  }

  return new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => resolve("");
    reader.readAsText(file);
  });
}

async function extractTextFromFile(file: File, setStatus: (status: string) => void) {
  if (file.type.startsWith("image/")) {
    setStatus(`Reading ${file.name} with OCR...`);
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const result = await worker.recognize(file);
      return result.data.text;
    } finally {
      await worker.terminate();
    }
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    setStatus(`PDF selected: ${file.name}. Text extraction for PDFs is not enabled yet.`);
    return "";
  }

  return fileToText(file);
}

createRoot(document.getElementById("root")!).render(<App />);
