// src/normalizer/normalizeQuery.ts

export type NormalizedIntent =
  | "STOCK_CHECK"
  | "LIST"
  | "ADD"
  | "UPDATE"
  | "REMOVE"
  | "SUMMARY"
  | "REORDER"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "MOST_EXPENSIVE"
  | "CHEAPEST"
  | "TOTAL_VALUE"
  | "TOP_ITEMS"
  | "CATEGORY_SUMMARY"
  | "SEARCH"
  | "UNKNOWN";

export interface NormalizedQuery {
  raw: string;
  cleaned: string;
  intent: NormalizedIntent;
  product?: string;
  amount?: number;
  category?: string;
}

/* ===============================
   Product Aliases
================================ */

const PRODUCT_ALIASES: Record<string, string> = {
  apple: "Red Apples",
  apples: "Red Apples",
  shirt: "Denim Shirt",
  shirts: "Denim Shirt",
  banana: "Banana",
  bananas: "Banana",
};

/* ===============================
   Stop Words
================================ */

const STOP_WORDS = [
  "please",
  "bro",
  "hey",
  "hi",
  "can",
  "you",
  "me",
  "tell",
  "check",
  "show",
  "give",
  "want",
  "need",
  "kindly",
];

/* ===============================
   Main Normalizer
================================ */

export function normalizeQuery(input: string): NormalizedQuery {
  const raw = input;

  /* -----------------------------
     Lowercase + cleanup
  ----------------------------- */

  let cleaned = input
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  /* -----------------------------
     Remove stop words
  ----------------------------- */

  cleaned = cleaned
    .split(" ")
    .filter((w) => !STOP_WORDS.includes(w))
    .join(" ");

  /* -----------------------------
     Extract numbers
  ----------------------------- */

  const numberMatch = cleaned.match(/\d+/);
  const amount = numberMatch ? parseInt(numberMatch[0]) : undefined;

  /* -----------------------------
     Detect product
  ----------------------------- */

  let product: string | undefined;

  for (const key of Object.keys(PRODUCT_ALIASES)) {
    if (cleaned.includes(key)) {
      product = PRODUCT_ALIASES[key];
      break;
    }
  }

  /* -----------------------------
     Detect intent
  ----------------------------- */

  const intent = detectIntent(cleaned);

  return {
    raw,
    cleaned,
    intent,
    product,
    amount,
  };
}

/* ===============================
   Intent Detection
================================ */

function detectIntent(text: string): NormalizedIntent {
  // STOCK
  if (matches(text, ["stock", "available", "quantity", "many"])) {
    return "STOCK_CHECK";
  }

  // LIST
  if (matches(text, ["list", "all", "inventory", "items"])) {
    return "LIST";
  }

  // ADD
  if (matches(text, ["add", "insert", "create", "new"])) {
    return "ADD";
  }

  // UPDATE
  if (matches(text, ["increase", "update", "raise", "plus"])) {
    return "UPDATE";
  }

  // REMOVE
  if (matches(text, ["remove", "reduce", "minus", "decrease"])) {
    return "REMOVE";
  }

  // SUMMARY
  if (matches(text, ["summary", "report", "dashboard", "overview"])) {
    return "SUMMARY";
  }

  // REORDER
  if (matches(text, ["reorder", "restock", "refill", "purchase"])) {
    return "REORDER";
  }

  // LOW STOCK
  if (matches(text, ["low", "running", "short"])) {
    return "LOW_STOCK";
  }

  // OUT OF STOCK
  if (matches(text, ["out", "empty", "sold"])) {
    return "OUT_OF_STOCK";
  }

  // MOST EXPENSIVE
  if (matches(text, ["expensive", "highest", "costly", "premium"])) {
    return "MOST_EXPENSIVE";
  }

  // CHEAPEST
  if (matches(text, ["cheap", "lowest", "budget"])) {
    return "CHEAPEST";
  }

  // TOTAL VALUE
  if (matches(text, ["value", "worth", "total", "money"])) {
    return "TOTAL_VALUE";
  }

  // TOP ITEMS
  if (matches(text, ["top", "most", "highest stock"])) {
    return "TOP_ITEMS";
  }

  // CATEGORY
  if (matches(text, ["category", "group", "type"])) {
    return "CATEGORY_SUMMARY";
  }

  // SEARCH
  if (matches(text, ["find", "search", "lookup"])) {
    return "SEARCH";
  }

  return "UNKNOWN";
}

/* ===============================
   Helpers
================================ */

function matches(text: string, keywords: string[]) {
  return keywords.some((k) => text.includes(k));
}
