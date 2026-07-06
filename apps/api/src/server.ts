import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import {
  buildStarterInsights,
  estimateDebtPayoffMonths,
  summarizeByCategory,
  summarizeMerchantItems,
  type Transaction
} from "@finance/shared";
import { debts, salary, transactions, transfers } from "./seed.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const users = new Map<string, { id: string; email: string; name: string; passwordHash: string; salt: string; createdAt: string }>();
const sessions = new Map<string, { userId: string; expiresAt: number }>();
const userConnections = new Map<string, ConnectionState[]>();
const sessionDurationMs = 1000 * 60 * 60 * 12;

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "finance-api" });
});

app.post("/api/auth/register", async (request, response) => {
  const body = request.body as { email?: string; password?: string; name?: string };
  const email = normalizeEmail(body.email);
  const password = body.password ?? "";
  const name = body.name?.trim() || email.split("@")[0];

  if (!email || !isValidEmail(email)) {
    response.status(400).json({ error: "Enter a valid email address." });
    return;
  }

  if (!isStrongPassword(password)) {
    response.status(400).json({ error: "Password must be at least 8 characters and include a letter and number." });
    return;
  }

  if (users.has(email)) {
    response.status(409).json({ error: "An account with this email already exists. Sign in instead." });
    return;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(password, salt);
  const user = { id: crypto.randomUUID(), email, name, passwordHash, salt, createdAt: new Date().toISOString() };
  users.set(email, user);

  response.status(201).json(createAuthResponse(user));
});

app.post("/api/auth/login", async (request, response) => {
  const body = request.body as { email?: string; password?: string };
  const email = normalizeEmail(body.email);
  const user = email ? users.get(email) : undefined;
  const passwordHash = user ? await hashPassword(body.password ?? "", user.salt) : "";

  if (!user || !crypto.timingSafeEqual(Buffer.from(passwordHash), Buffer.from(user.passwordHash))) {
    response.status(401).json({ error: "Invalid email or password." });
    return;
  }

  response.json(createAuthResponse(user));
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  response.json({ user: request.user });
});

app.get("/api/connections", requireAuth, (request, response) => {
  response.json({
    plaidConfigured: isPlaidConfigured(),
    connections: getConnections(request.user!.id)
  });
});

app.post("/api/connections/plaid/link-token", requireAuth, (_request, response) => {
  if (!isPlaidConfigured()) {
    response.status(501).json({
      error: "Plaid is not configured yet. Add PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV to enable live bank/card linking."
    });
    return;
  }

  response.json({
    linkToken: "plaid-link-token-placeholder",
    message: "Plaid SDK integration can replace this placeholder once credentials are configured."
  });
});

app.post("/api/connections/:id/disconnect", requireAuth, (request, response) => {
  const connections = getConnections(request.user!.id).map(connection => (
    connection.id === request.params.id
      ? { ...connection, status: "not_connected" as const, lastSync: null }
      : connection
  ));
  userConnections.set(request.user!.id, connections);
  response.json({ connections });
});

app.post("/api/imports", requireAuth, (request, response) => {
  const body = request.body as { files?: UploadedFile[] };

  if (!body.files?.length) {
    response.status(400).json({ error: "Upload at least one screenshot, PDF, statement, receipt, or supporting file." });
    return;
  }

  const results = body.files.map(file => classifyUploadedFile(file));
  const importedTransactions = results.flatMap(result => result.transactions);
  transactions.unshift(...importedTransactions);

  response.status(201).json({
    importedCount: importedTransactions.length,
    files: results,
    categorySummary: summarizeByCategory(importedTransactions)
  });
});

app.get("/api/overview", requireAuth, (_request, response) => {
  response.json({
    transactions,
    debts: debts.map(debt => ({ ...debt, payoffMonths: estimateDebtPayoffMonths(debt) })),
    salary,
    transfers,
    categorySummary: summarizeByCategory(transactions),
    merchantSummary: summarizeMerchantItems(transactions, "Macy's"),
    insights: buildStarterInsights(transactions, debts)
  });
});

app.post("/api/transactions", requireAuth, (request, response) => {
  const body = request.body as Partial<Transaction>;

  if (!body.amount || !body.currency || !body.date || !body.merchant || !body.category) {
    response.status(400).json({ error: "amount, currency, date, merchant, and category are required" });
    return;
  }

  const transaction: Transaction = {
    id: `txn_${Date.now()}`,
    amount: body.amount,
    currency: body.currency,
    date: body.date,
    merchant: body.merchant,
    category: body.category,
    subcategory: body.subcategory,
    tags: body.tags ?? [],
    country: body.country ?? "US",
    source: body.source ?? "manual",
    confidence: body.confidence ?? 1,
    notes: body.notes,
    items: body.items ?? []
  };

  transactions.unshift(transaction);
  response.status(201).json(transaction);
});

app.listen(port, () => {
  console.log(`Finance API listening on http://localhost:${port}`);
});

function normalizeEmail(email: string | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password: string) {
  return /[a-zA-Z]/.test(password) && /\d/.test(password) && password.length >= 8;
}

async function hashPassword(password: string, salt: string) {
  return new Promise<string>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey.toString("hex"));
    });
  });
}

function createAuthResponse(user: { id: string; email: string; name: string }) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionDurationMs });
  return { token, user: { id: user.id, email: user.email, name: user.name } };
}

function requireAuth(request: express.Request, response: express.Response, next: express.NextFunction) {
  const token = request.header("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token ? sessions.get(token) : undefined;

  if (!token || !session || session.expiresAt < Date.now()) {
    if (token) {
      sessions.delete(token);
    }
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const user = Array.from(users.values()).find(item => item.id === session.userId);
  if (!user) {
    sessions.delete(token);
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  request.user = { id: user.id, email: user.email, name: user.name };
  next();
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string };
    }
  }
}

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  extractedText?: string;
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

function isPlaidConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.PLAID_ENV);
}

function getConnections(userId: string) {
  if (!userConnections.has(userId)) {
    userConnections.set(userId, buildDefaultConnections());
  }
  return userConnections.get(userId)!;
}

function buildDefaultConnections(): ConnectionState[] {
  return [
    {
      id: "banks-cards",
      name: "Plaid Banks & Cards",
      category: "Banks & Cards",
      status: isPlaidConfigured() ? "not_connected" : "needs_config",
      lastSync: null,
      dataUsed: ["Transactions", "Balances", "Account names", "Institution metadata"],
      permissionScope: "Read-only bank/card access via Plaid Link",
      privacyNote: "Aalsi should never collect bank passwords. Plaid handles credentials and returns read-only financial data."
    },
    {
      id: "email-receipts",
      name: "Email Receipts",
      category: "Email Receipts",
      status: "not_connected",
      lastSync: null,
      dataUsed: ["Receipt emails", "Merchant", "Items", "Order totals"],
      permissionScope: "Receipt/order emails only",
      privacyNote: "Use narrow mailbox scopes and avoid reading personal emails unrelated to receipts."
    },
    {
      id: "shopping-apps",
      name: "Shopping Apps",
      category: "Shopping Apps",
      status: "not_connected",
      lastSync: null,
      dataUsed: ["Orders", "Item names", "Returns", "Refunds"],
      permissionScope: "Order history imports or forwarded receipts",
      privacyNote: "Shopping data can reveal lifestyle habits, so item-level analysis should remain user controlled."
    },
    {
      id: "food-delivery",
      name: "Food & Delivery",
      category: "Food & Delivery",
      status: "not_connected",
      lastSync: null,
      dataUsed: ["Restaurant", "Order items", "Tips", "Fees"],
      permissionScope: "Receipt imports from delivery apps",
      privacyNote: "Food data can be sensitive if health preferences are enabled; keep that analysis opt-in."
    },
    {
      id: "travel",
      name: "Travel",
      category: "Travel",
      status: "not_connected",
      lastSync: null,
      dataUsed: ["Bookings", "Hotels", "Flights", "Rides"],
      permissionScope: "Travel confirmations and uploaded documents",
      privacyNote: "Travel data may expose location patterns, so summaries should minimize raw itinerary details."
    },
    {
      id: "cloud-storage",
      name: "Cloud Storage",
      category: "Cloud Storage",
      status: "not_connected",
      lastSync: null,
      dataUsed: ["Statements", "Receipts", "PDFs", "CSV files"],
      permissionScope: "Selected folder access only",
      privacyNote: "Prefer a dedicated Aalsi folder instead of broad drive access."
    },
    {
      id: "manual-imports",
      name: "Manual Imports",
      category: "Manual Imports",
      status: "connected",
      lastSync: new Date().toISOString(),
      dataUsed: ["Uploaded screenshots", "PDFs", "CSVs", "Receipt text"],
      permissionScope: "Files selected by user",
      privacyNote: "Manual imports use only the files you choose to upload."
    }
  ];
}

function classifyUploadedFile(file: UploadedFile) {
  const text = `${file.name}\n${file.extractedText ?? ""}`;
  const lowerName = text.toLowerCase();
  const documentType = getDocumentType(file);
  const parsedReceipt = parseReceiptText(text, documentType, file.name);
  const category = parsedReceipt?.category ?? inferCategory(lowerName);
  const merchant = parsedReceipt?.merchant ?? inferMerchant(lowerName);
  const transaction = parsedReceipt ? [parsedReceipt] : [];

  return {
    fileName: file.name,
    documentType,
    detectedMerchant: merchant,
    detectedCategory: category,
    confidence: parsedReceipt ? 0.86 : 0.35,
    needsReview: !parsedReceipt,
    reviewMessage: parsedReceipt
      ? "Imported from parsed receipt text."
      : "No readable receipt text was available. Image/PDF uploads are accepted, but scanned documents need OCR text before transactions can be created.",
    evidence: [
      `File type: ${file.type || "unknown"}`,
      `File name: ${file.name}`,
      `Size: ${file.size} bytes`,
      parsedReceipt ? "Parsed exact amount from receipt text." : "No exact amount found; no transaction was created."
    ],
    transactions: transaction
  };
}

function parseReceiptText(text: string, documentType: string, fileName: string): Transaction | null {
  const lowerText = text.toLowerCase();
  const merchant = inferMerchant(lowerText);
  const orderTotal = extractMoneyAfter(text, /order total/i);
  const grandTotal = extractMoneyAfter(text, /grand total/i);
  const itemSubtotal = extractMoneyAfter(text, /item\(s\) subtotal|subtotal/i);
  const totalBeforeTax = extractMoneyAfter(text, /total before tax/i);
  const total = firstPositive(orderTotal, grandTotal, totalBeforeTax, itemSubtotal, extractLastMoney(text));

  if (!total || merchant === "Imported document") {
    return null;
  }

  const items = parseReceiptItems(text).map((parsedItem, index) => {
      const name = parsedItem.name;
      const amount = parsedItem.amount;
      const itemCategory = inferItemCategory(name);
      const category = itemCategory === "Cosmetics" ? "Personal Care" : itemCategory === "Clothing" ? "Shopping" : itemCategory;
      return {
        id: `item_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`,
        transactionId: "",
        name,
        amount,
        category,
        subcategory: itemCategory,
        itemCategory,
        confidence: 0.82
      };
    });

  const transactionId = `txn_import_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const transaction: Transaction = {
    id: transactionId,
    amount: total,
    currency: lowerText.includes("inr") || lowerText.includes("india") ? "INR" : "USD",
    date: extractDate(text) ?? new Date().toISOString().slice(0, 10),
    merchant,
    category: getPrimaryCategory(items),
    subcategory: documentType,
    tags: ["imported", documentType, "itemized"],
    country: lowerText.includes("inr") || lowerText.includes("india") ? "IN" : "US",
    source: documentType === "receipt" ? "receipt_ocr" : "statement_ocr",
    confidence: 0.86,
    notes: `Imported from ${fileName}. Total and item lines were parsed from extracted receipt text.`,
    items: []
  };

  transaction.items = items.map(item => ({ ...item, transactionId }));
  return transaction;
}

function extractMoneyAfter(text: string, label: RegExp) {
  const lines = text.split(/\r?\n/);
  const line = lines.find(item => label.test(item));
  const match = line?.match(/\$(\d{1,6}\.\d{2})/);
  return match ? Number(match[1]) : null;
}

function parseReceiptItems(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const items: Array<{ name: string; amount: number }> = [];

  lines.forEach((line, index) => {
    const money = line.match(/\$(\d{1,5}\.\d{2})/);
    if (!money || isSummaryLine(line)) {
      return;
    }

    const inlineName = line.replace(/\$(\d{1,5}\.\d{2}).*/, "").trim();
    const name = inlineName.length > 4 ? inlineName : findNearbyProductName(lines, index);
    if (!name) {
      return;
    }

    items.push({ name, amount: Number(money[1]) });
  });

  return items;
}

function findNearbyProductName(lines: string[], priceIndex: number) {
  for (let index = priceIndex - 1; index >= Math.max(0, priceIndex - 6); index -= 1) {
    const candidate = lines[index];
    if (!candidate || isSummaryLine(candidate) || /sold by|return|eligible|through|auto-delivered|view your item|qty|color|size|upc/i.test(candidate)) {
      continue;
    }
    return candidate.replace(/\s+/g, " ");
  }
  return "";
}

function isSummaryLine(line: string) {
  return /order total|grand total|subtotal|tax|shipping|handling|promotional|gift card|cash back|refund total|payment information/i.test(line);
}

function extractLastMoney(text: string) {
  const matches = Array.from(text.matchAll(/\$(\d{1,6}\.\d{2})/g));
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null;
}

function firstPositive(...values: Array<number | null>) {
  return values.find(value => typeof value === "number" && value > 0) ?? null;
}

function extractDate(text: string) {
  const match = text.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}/i);
  const parsed = match ? new Date(match[0]) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function inferItemCategory(name: string) {
  if (/lip|balm|cosmetic|moistur|makeup|beauty|clinique/i.test(name)) return "Cosmetics";
  if (/cream|serum|niacinamide|salicylic|axis-y|ordinary|dr\.?.?althea|skin|skincare/i.test(name)) return "Skincare";
  if (/shirt|t-shirt|tee|pants|trouser|jeans|levi|dress|clothing/i.test(name)) return "Clothing";
  if (/coffee|snack|meal|food|grocery/i.test(name)) return "Food";
  return "General merchandise";
}

function getPrimaryCategory(items: Transaction["items"]) {
  if (items.some(item => item.itemCategory === "Clothing")) return "Shopping";
  if (items.some(item => item.itemCategory === "Cosmetics" || item.itemCategory === "Skincare")) return "Personal Care";
  return "Shopping";
}

function getDocumentType(file: UploadedFile) {
  const lowerName = file.name.toLowerCase();
  if (file.type.includes("pdf") || lowerName.endsWith(".pdf")) return "statement";
  if (file.type.startsWith("image/") || /screenshot|receipt|bill/.test(lowerName)) return "receipt";
  if (/csv|statement|bank|card/.test(lowerName)) return "statement";
  return "supporting document";
}

function inferCategory(text: string) {
  if (/rent|mortgage|home|housing/.test(text)) return "Housing";
  if (/loan|emi|debt/.test(text)) return "Debt";
  if (/salary|payroll|income/.test(text)) return "Income";
  if (/walmart|trader|grocery|food|restaurant|coffee|starbucks/.test(text)) return "Food";
  if (/macy|amazon|shopping|target|clothing/.test(text)) return "Shopping";
  if (/flight|hotel|uber|travel/.test(text)) return "Travel";
  if (/card|visa|mastercard|amex/.test(text)) return "Credit Card";
  return "Miscellaneous";
}

function inferMerchant(text: string) {
  if (text.includes("macy")) return "Macy's";
  if (text.includes("walmart")) return "Walmart";
  if (text.includes("trader")) return "Trader Joe's";
  if (text.includes("amazon")) return "Amazon";
  if (text.includes("starbucks")) return "Starbucks";
  if (text.includes("home depot")) return "Home Depot";
  if (text.includes("salary") || text.includes("payroll")) return "Employer deposit";
  return "Imported document";
}

function inferAmount(text: string, category: string) {
  const amountMatch = text.match(/(?:usd|inr|rs|\$)?\s?(\d{2,6})(?:[._-](\d{2}))?/i);
  if (amountMatch) {
    return Number(`${amountMatch[1]}.${amountMatch[2] ?? "00"}`);
  }

  if (category === "Income") return 0;
  if (category === "Debt") return 450;
  if (category === "Housing") return 1200;
  if (category === "Food") return 42;
  if (category === "Shopping") return 86;
  return 25;
}
