export type Currency = "USD" | "INR";

export type TransactionSource =
  | "manual"
  | "natural_language"
  | "receipt_ocr"
  | "statement_ocr"
  | "email_forward"
  | "telegram_bot"
  | "discord_bot"
  | "sms_paste";

export type Category = {
  id: string;
  name: string;
  parentId?: string;
};

export type TransactionItem = {
  id: string;
  transactionId: string;
  name: string;
  amount: number;
  quantity?: number;
  category: string;
  subcategory?: string;
  itemCategory?: string;
  confidence?: number;
};

export type Transaction = {
  id: string;
  amount: number;
  currency: Currency;
  date: string;
  merchant: string;
  category: string;
  subcategory?: string;
  tags: string[];
  country: "US" | "IN" | "Other";
  source: TransactionSource;
  confidence: number;
  notes?: string;
  items: TransactionItem[];
};

export type Debt = {
  id: string;
  name: string;
  lender: string;
  balance: number;
  currency: Currency;
  annualInterestRate: number;
  minimumPayment: number;
  regularPayment: number;
  dueDayOfMonth: number;
  lateFee: number;
};

export type SalaryIncome = {
  id: string;
  employer: string;
  grossAmount: number;
  netAmount: number;
  currency: Currency;
  country: "US" | "IN" | "Other";
  payDate: string;
  taxWithheld: number;
  deductions: number;
};

export type CrossBorderTransfer = {
  id: string;
  sourceCountry: "US" | "IN" | "Other";
  destinationCountry: "US" | "IN" | "Other";
  sourceCurrency: Currency;
  destinationCurrency: Currency;
  sourceAmount: number;
  receivedAmount: number;
  exchangeRate: number;
  fee: number;
  provider: string;
  recipient: string;
  purpose: string;
  sentDate: string;
};

export type Insight = {
  id: string;
  title: string;
  body: string;
  action?: string;
  severity: "info" | "warning" | "positive";
};

export function formatMoney(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "INR" ? 0 : 2
  }).format(amount);
}

export function summarizeByCategory(transactions: Transaction[]) {
  return transactions.reduce<Record<string, number>>((summary, transaction) => {
    summary[transaction.category] = (summary[transaction.category] ?? 0) + transaction.amount;
    return summary;
  }, {});
}

export function summarizeMerchantItems(transactions: Transaction[], merchant: string) {
  const matching = transactions.filter(
    transaction => transaction.merchant.toLowerCase() === merchant.toLowerCase()
  );

  const total = matching.reduce((sum, transaction) => sum + transaction.amount, 0);
  const contributions = matching.flatMap(transaction => transaction.items).reduce<Record<string, number>>(
    (summary, item) => {
      const key = item.itemCategory ?? item.subcategory ?? item.category;
      summary[key] = (summary[key] ?? 0) + item.amount;
      return summary;
    },
    {}
  );

  return { merchant, total, contributions };
}

export function estimateDebtPayoffMonths(debt: Debt): number | null {
  const monthlyRate = debt.annualInterestRate / 100 / 12;
  const payment = debt.regularPayment;

  if (payment <= debt.balance * monthlyRate) {
    return null;
  }

  if (monthlyRate === 0) {
    return Math.ceil(debt.balance / payment);
  }

  const months = -Math.log(1 - (debt.balance * monthlyRate) / payment) / Math.log(1 + monthlyRate);
  return Math.ceil(months);
}

export function buildStarterInsights(transactions: Transaction[], debts: Debt[]): Insight[] {
  const categoryTotals = summarizeByCategory(transactions);
  const highestCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
  const nextDebtDue = debts[0];

  const insights: Insight[] = [];

  if (highestCategory) {
    insights.push({
      id: "top-category",
      title: `${highestCategory[0]} is your top spending area`,
      body: `Your current tracked spend in this category is ${formatMoney(highestCategory[1], "USD")}. Review merchant and item breakdowns before setting a budget.`,
      action: "Open category filters and inspect top merchants.",
      severity: "info"
    });
  }

  if (nextDebtDue) {
    const payoffMonths = estimateDebtPayoffMonths(nextDebtDue);
    insights.push({
      id: "debt-payoff",
      title: `${nextDebtDue.name} payoff estimate`,
      body: payoffMonths
        ? `At your current payment, estimated payoff is about ${payoffMonths} months.`
        : "Your current payment may not cover monthly interest. Increase the regular payment to reduce principal.",
      action: "Try an extra payment simulation.",
      severity: payoffMonths ? "warning" : "warning"
    });
  }

  return insights;
}
