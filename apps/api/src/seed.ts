import type { CrossBorderTransfer, Debt, SalaryIncome, Transaction } from "@finance/shared";

export const transactions: Transaction[] = [
  {
    id: "txn_macy_001",
    amount: 320,
    currency: "USD",
    date: "2026-06-10",
    merchant: "Macy's",
    category: "Shopping",
    subcategory: "Department Store",
    tags: ["Macy's", "Quarterly Shopping"],
    country: "US",
    source: "receipt_ocr",
    confidence: 0.91,
    items: [
      {
        id: "item_001",
        transactionId: "txn_macy_001",
        name: "Pants",
        amount: 120,
        quantity: 3,
        category: "Shopping",
        subcategory: "Clothing",
        itemCategory: "Pants",
        confidence: 0.89
      },
      {
        id: "item_002",
        transactionId: "txn_macy_001",
        name: "Tops",
        amount: 90,
        quantity: 3,
        category: "Shopping",
        subcategory: "Clothing",
        itemCategory: "Tops",
        confidence: 0.87
      },
      {
        id: "item_003",
        transactionId: "txn_macy_001",
        name: "Cosmetics",
        amount: 110,
        quantity: 4,
        category: "Shopping",
        subcategory: "Cosmetics",
        itemCategory: "Cosmetics",
        confidence: 0.83
      }
    ]
  },
  {
    id: "txn_chipotle_001",
    amount: 18.42,
    currency: "USD",
    date: "2026-06-12",
    merchant: "Chipotle",
    category: "Food",
    subcategory: "Eating Out",
    tags: ["Lunch"],
    country: "US",
    source: "natural_language",
    confidence: 0.96,
    items: []
  },
  {
    id: "txn_hdfc_emi_001",
    amount: 12000,
    currency: "INR",
    date: "2026-06-05",
    merchant: "HDFC Bank",
    category: "Debt",
    subcategory: "EMI",
    tags: ["India", "Loan"],
    country: "IN",
    source: "manual",
    confidence: 1,
    items: []
  }
];

export const debts: Debt[] = [
  {
    id: "debt_chase_001",
    name: "Chase Credit Card",
    lender: "Chase",
    balance: 4800,
    currency: "USD",
    annualInterestRate: 21.99,
    minimumPayment: 150,
    regularPayment: 250,
    dueDayOfMonth: 24,
    lateFee: 40
  }
];

export const salary: SalaryIncome[] = [
  {
    id: "salary_001",
    employer: "Acme Software",
    grossAmount: 9200,
    netAmount: 6500,
    currency: "USD",
    country: "US",
    payDate: "2026-06-15",
    taxWithheld: 2100,
    deductions: 600
  }
];

export const transfers: CrossBorderTransfer[] = [
  {
    id: "transfer_001",
    sourceCountry: "US",
    destinationCountry: "IN",
    sourceCurrency: "USD",
    destinationCurrency: "INR",
    sourceAmount: 500,
    receivedAmount: 41650,
    exchangeRate: 83.3,
    fee: 3.99,
    provider: "Wise",
    recipient: "Family",
    purpose: "Family support",
    sentDate: "2026-06-03"
  }
];
