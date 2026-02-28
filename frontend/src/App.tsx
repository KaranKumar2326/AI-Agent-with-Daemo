import { useState, useRef, useEffect, useCallback } from "react";

// ─── ENV CONFIG ───────────────────────────────────────────────────────────────
const AGENT_ID = import.meta.env.VITE_DAEMO_AGENT_ID;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const API_KEY = import.meta.env.VITE_DAEMO_API_KEY;
const GOOGLE_SHEET_ID = "10nSkephAlzBd4qDkPTBfx6C1zVRJGRrWNiKtHBq47jw";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Message = {
  id: string;
  role: "user" | "bot";
  text: string;
  timestamp: Date;
  table?: any[] | null;
  status?: "ok" | "error" | "warning";
};

type ServerStatus = "idle" | "checking" | "online" | "offline";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Safely parse a preview string that may be JSON or a JS object literal */
function safeParsePreview(preview: unknown): any {
  if (preview === null || preview === undefined) return null;
  if (typeof preview === "object") return preview;
  if (typeof preview !== "string") return null;

  const str = preview.trim();
  if (!str || str === "[]" || str === "{}") return null;

  // Try standard JSON first
  try {
    return JSON.parse(str);
  } catch {
    // no-op
  }

  // Fall back to JS object literal (trusted internal API only)
  try {
    // eslint-disable-next-line no-new-func
    return Function('"use strict"; return (' + str + ')')();
  } catch {
    return null;
  }
}

/** Keys that indicate a summary/meta object rather than tabular row data */
const SUMMARY_KEYS = new Set([
  "totalProducts", "totalQuantity", "totalValue",
  "lowStockCount", "outOfStockCount", "executionTime",
  "meta", "status", "error", "functionsUsed",
]);

function isSummaryObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  return keys.length > 0 && keys.every(k => SUMMARY_KEYS.has(k));
}

/** Normalize any parsed value into a table-ready array or null */
function normalizeToTable(parsed: any): any[] | null {
  if (parsed === null || parsed === undefined) return null;

  // Empty array
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return null;
    // Filter out non-object elements
    const rows = parsed.filter(r => r && typeof r === "object");
    return rows.length > 0 ? rows : null;
  }

  if (typeof parsed !== "object") return null;

  // Unwrap { meta, ...rest } — strip meta field
  const { meta, ...rest } = parsed as any;

  if (Object.keys(rest).length === 0) return null;

  // If it looks like a summary, still show it as a single-row table
  // (the caller decides whether to use it as text or table)
  return [rest];
}

/** Extract readable text from a Daemo JSX string */
function extractTextFromJSX(jsx: string): string {
  const lines: string[] = [];

  // Main CardTitle (first one = page heading)
  const titles = [...jsx.matchAll(/<CardTitle[^>]*>([\s\S]*?)<\/CardTitle>/g)];
  const descriptions = [...jsx.matchAll(/<CardDescription[^>]*>([\s\S]*?)<\/CardDescription>/g)];
  const paragraphs = [...jsx.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  const boldDivs = [...jsx.matchAll(/<div[^>]*font-bold[^>]*>([\s\S]*?)<\/div>/g)];

  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  if (titles.length > 0) {
    lines.push(stripTags(titles[0][1]));
  }

  // Pair sub-card titles with their bold values
  const subTitles = titles.slice(1).map(m => stripTags(m[1]));
  const boldValues = boldDivs.map(m => stripTags(m[1]));

  subTitles.forEach((title, i) => {
    const val = boldValues[i];
    if (val) lines.push(`${title}: ${val}`);
    else lines.push(title);
  });

  // Descriptions and paragraphs
  [...descriptions, ...paragraphs].forEach(m => {
    const t = stripTags(m[1]);
    if (t && !lines.some(l => l.includes(t.slice(0, 30)))) {
      lines.push(t);
    }
  });

  if (lines.length > 0) return lines.join("\n");

  // Hard fallback: strip all tags
  return jsx.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Main response parser — returns { text, table } */
function parseDaemoResponse(data: any): { text: string; table: any[] | null } {
  let text = "";
  let table: any[] | null = null;

  // ── 1. Plain text ──────────────────────────────────────────────────────────
  if (typeof data?.text === "string" && data.text.trim()) {
    text = data.text.trim();
  }
  // ── 2. JSX ─────────────────────────────────────────────────────────────────
  else if (typeof data?.jsx === "string" && data.jsx.trim()) {
    text = extractTextFromJSX(data.jsx);
  }

  // ── 3. Tool interactions → table data ──────────────────────────────────────
  if (Array.isArray(data?.toolInteractions)) {
    // Iterate all tool calls; prefer the last one that yields a good table
    for (const tool of data.toolInteractions) {
      const stored: any[] | undefined = tool?.result?.stored;

      if (Array.isArray(stored)) {
        for (const item of stored) {
          if (!item?.preview) continue;

          const parsed = safeParsePreview(item.preview);
          if (parsed === null) continue;

          const normalized = normalizeToTable(parsed);
          if (normalized && normalized.length > 0) {
            // Prefer actual row data over summary objects
            const firstRow = normalized[0];
            if (typeof firstRow === "object" && !isSummaryObject(firstRow)) {
              table = normalized;
            } else if (!table) {
              // Fallback: use summary as table if nothing better found
              table = normalized;
            }
          }
        }
      }

      // Also check direct result object
      const result = tool?.result?.result;
      if (!table && result && typeof result === "object" && !result?.error) {
        const { meta, ...clean } = result as any;
        if (Object.keys(clean).length > 0) {
          table = [clean];
        }
      }
    }
  }

  // ── 4. Final text fallback ─────────────────────────────────────────────────
  if (!text && table) {
    text = `Found ${table.length} result${table.length !== 1 ? "s" : ""}. See table below.`;
  } else if (!text) {
    text = "⚠️ No readable response received.";
  }

  return { text, table };
}

/** Parse CSV text into array of objects */
function parseCSV(csvText: string): any[] {
  const rows = csvText.split("\n").map(row => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  });

  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.replace(/^\uFEFF/, "").trim()); // strip BOM
  return rows
    .slice(1)
    .filter(row => row.some(cell => cell.trim()))
    .map(row => {
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] ?? "";
      });
      return obj;
    });
}

/** Generate a unique message ID */
function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const [sheetData, setSheetData] = useState<any[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [serverStatus, setServerStatus] = useState<ServerStatus>("idle");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, expandedTables]);

  // On mount
  useEffect(() => {
    wakeServer();
    fetchGoogleSheetData();
  }, []);

  // ── Server health ────────────────────────────────────────────────────────
  async function wakeServer() {
    setServerStatus("checking");
    try {
      const res = await fetch(`${BACKEND_URL}/`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("Non-OK response");
      setServerStatus("online");
    } catch {
      setServerStatus("offline");
    }
  }

  // ── Google Sheet fetch ───────────────────────────────────────────────────
  const fetchGoogleSheetData = useCallback(async () => {
    setSheetLoading(true);
    setSheetError(null);
    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=0`;
      const response = await fetch(csvUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        throw new Error(
          "Failed to fetch sheet data. Make sure the sheet is published to the web (File → Share → Publish to web)."
        );
      }
      const csvText = await response.text();
      const data = parseCSV(csvText);
      setSheetData(data);
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : "Failed to load sheet data");
    } finally {
      setSheetLoading(false);
    }
  }, []);

  // ── Toggle table expansion per message ──────────────────────────────────
  function toggleTable(id: string) {
    setExpandedTables(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Send message ─────────────────────────────────────────────────────────
  async function sendMessage() {
    const query = input.trim();
    if (!query || loading) return;

    const userMsg: Message = {
      id: genId(),
      role: "user",
      text: query,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const url = `https://backend.daemo.ai/agents/${AGENT_ID}/query`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        throw new Error(`Server responded with status ${res.status}`);
      }

      const rawText = await res.text();

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error("Invalid JSON response from server");
      }

      const { text, table } = parseDaemoResponse(data);

      const botMsg: Message = {
        id: genId(),
        role: "bot",
        text,
        timestamp: new Date(),
        table: table,
        status: "ok",
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      const botMsg: Message = {
        id: genId(),
        role: "bot",
        text: isTimeout
          ? "⏱ Request timed out. The server may be starting up — please try again."
          : err?.message
            ? `Error: ${err.message}`
            : "Connection error. Please check your network and try again.",
        timestamp: new Date(),
        status: "error",
      };
      setMessages(prev => [...prev, botMsg]);
    } finally {
      setLoading(false);
    }
  }

  function formatTime(date: Date) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
          --bg:         #0C0E12;
          --surface:    #13161D;
          --surface2:   #1A1E27;
          --surface3:   #222733;
          --border:     #2A2F3E;
          --border2:    #333848;
          --accent:     #4F8EF7;
          --accent2:    #6FFFB0;
          --accent3:    #FF6B6B;
          --text1:      #EEF0F6;
          --text2:      #8B92A8;
          --text3:      #555D72;
          --radius:     10px;
          --radius-lg:  16px;
          --shadow:     0 4px 24px rgba(0,0,0,0.4);
          --shadow-lg:  0 12px 40px rgba(0,0,0,0.5);
          --font:       'Syne', sans-serif;
          --mono:       'DM Mono', monospace;
        }

        body {
          font-family: var(--font);
          background: var(--bg);
          color: var(--text1);
          -webkit-font-smoothing: antialiased;
        }

        .app {
          height: 100vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        /* ── HEADER ── */
        .header {
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          padding: 0 28px;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
          position: relative;
          z-index: 20;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo-mark {
          width: 34px;
          height: 34px;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 800;
          color: var(--bg);
          letter-spacing: -1px;
          flex-shrink: 0;
        }

        .header h1 {
          font-size: 16px;
          font-weight: 700;
          color: var(--text1);
          letter-spacing: -0.02em;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .server-btn {
          padding: 6px 14px;
          background: var(--surface2);
          border: 1px solid var(--border2);
          border-radius: var(--radius);
          color: var(--text2);
          font-size: 12px;
          font-weight: 600;
          font-family: var(--font);
          cursor: pointer;
          transition: all 0.18s ease;
          letter-spacing: 0.01em;
        }

        .server-btn:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent);
        }

        .server-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .status-pill {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 5px 12px;
          border-radius: 100px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
          transition: all 0.3s ease;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .status-dot.pulse {
          animation: statusPulse 2s ease-in-out infinite;
        }

        @keyframes statusPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        /* ── MAIN LAYOUT ── */
        .main-content {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 1fr;
          overflow: hidden;
          gap: 0;
        }

        .panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-right: 1px solid var(--border);
        }

        .panel:last-child { border-right: none; }

        .panel-header {
          padding: 12px 20px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--surface);
          flex-shrink: 0;
        }

        .panel-label {
          font-size: 11px;
          font-weight: 700;
          color: var(--text3);
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .refresh-btn {
          padding: 5px 12px;
          background: transparent;
          border: 1px solid var(--border2);
          border-radius: 6px;
          color: var(--text2);
          font-size: 11px;
          font-weight: 600;
          font-family: var(--font);
          cursor: pointer;
          transition: all 0.18s;
          letter-spacing: 0.03em;
        }

        .refresh-btn:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent);
        }

        .refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── CHAT ── */
        .chat-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          background: var(--bg);
        }

        .chat-scroll::-webkit-scrollbar { width: 4px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

        /* ── EMPTY STATE ── */
        .empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 40px;
          animation: fadeIn 0.4s ease;
        }

        .empty-icon {
          font-size: 36px;
          margin-bottom: 4px;
          opacity: 0.6;
        }

        .empty-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text2);
        }

        .empty-desc {
          font-size: 13px;
          color: var(--text3);
          text-align: center;
          max-width: 280px;
          line-height: 1.6;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── MESSAGE GROUP ── */
        .msg-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
          animation: msgIn 0.25s ease-out;
        }

        @keyframes msgIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .msg-group.user { align-items: flex-end; }
        .msg-group.bot  { align-items: flex-start; }

        .msg-meta {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 0 3px;
        }

        .msg-role {
          font-size: 11px;
          font-weight: 700;
          color: var(--text3);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .msg-time {
          font-size: 11px;
          color: var(--text3);
          font-family: var(--mono);
        }

        .msg-bubble {
          max-width: 88%;
          padding: 12px 16px;
          border-radius: var(--radius-lg);
          font-size: 13.5px;
          line-height: 1.65;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .msg-bubble.user {
          background: var(--accent);
          color: #fff;
          border-bottom-right-radius: 4px;
          box-shadow: 0 2px 12px rgba(79,142,247,0.25);
        }

        .msg-bubble.bot {
          background: var(--surface2);
          color: var(--text1);
          border: 1px solid var(--border);
          border-bottom-left-radius: 4px;
        }

        .msg-bubble.bot.error {
          background: rgba(255, 107, 107, 0.08);
          border-color: rgba(255, 107, 107, 0.3);
          color: #ff9b9b;
        }

        /* ── TABLE TOGGLE BUTTON ── */
        .table-toggle-btn {
          margin-top: 6px;
          align-self: flex-start;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: rgba(111, 255, 176, 0.08);
          border: 1px solid rgba(111, 255, 176, 0.25);
          border-radius: var(--radius);
          color: var(--accent2);
          font-size: 12px;
          font-weight: 700;
          font-family: var(--font);
          cursor: pointer;
          transition: all 0.18s;
          letter-spacing: 0.02em;
        }

        .table-toggle-btn:hover {
          background: rgba(111, 255, 176, 0.14);
          border-color: rgba(111, 255, 176, 0.45);
          transform: translateY(-1px);
        }

        .table-toggle-btn .arrow {
          font-size: 10px;
          transition: transform 0.2s;
        }

        .table-toggle-btn.open .arrow { transform: rotate(180deg); }

        /* ── INLINE TABLE ── */
        .inline-table-wrap {
          margin-top: 8px;
          width: 100%;
          max-width: 100%;
          background: var(--surface2);
          border: 1px solid var(--border2);
          border-radius: var(--radius-lg);
          overflow: hidden;
          box-shadow: var(--shadow);
          animation: msgIn 0.2s ease-out;
        }

        .inline-table-header {
          padding: 10px 16px;
          background: var(--surface3);
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border);
        }

        .inline-table-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--text2);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .inline-table-count {
          font-size: 11px;
          font-family: var(--mono);
          color: var(--accent2);
          background: rgba(111,255,176,0.1);
          padding: 2px 8px;
          border-radius: 20px;
        }

        .inline-table-scroll {
          overflow-x: auto;
          max-height: 320px;
          overflow-y: auto;
        }

        .inline-table-scroll::-webkit-scrollbar { height: 4px; width: 4px; }
        .inline-table-scroll::-webkit-scrollbar-track { background: transparent; }
        .inline-table-scroll::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

        .inline-table-scroll table {
          width: 100%;
          border-collapse: collapse;
        }

        .inline-table-scroll th {
          background: var(--surface3);
          padding: 9px 14px;
          font-size: 11px;
          font-weight: 700;
          color: var(--text3);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
          position: sticky;
          top: 0;
          z-index: 2;
        }

        .inline-table-scroll td {
          padding: 9px 14px;
          font-size: 12px;
          font-family: var(--mono);
          color: var(--text1);
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }

        .inline-table-scroll tr:last-child td { border-bottom: none; }

        .inline-table-scroll tbody tr:hover { background: var(--surface3); }

        /* ── TYPING INDICATOR ── */
        .typing-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          border-bottom-left-radius: 4px;
          width: fit-content;
        }

        .typing-dots { display: flex; gap: 5px; }

        .typing-dot {
          width: 6px;
          height: 6px;
          background: var(--text3);
          border-radius: 50%;
          animation: typingBounce 1.3s ease-in-out infinite;
        }

        .typing-dot:nth-child(1) { animation-delay: 0s; }
        .typing-dot:nth-child(2) { animation-delay: 0.18s; }
        .typing-dot:nth-child(3) { animation-delay: 0.36s; }

        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30%            { transform: translateY(-7px); opacity: 1; }
        }

        .typing-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text3);
          letter-spacing: 0.04em;
        }

        /* ── INPUT ── */
        .input-bar {
          padding: 16px 20px;
          background: var(--surface);
          border-top: 1px solid var(--border);
          display: flex;
          gap: 10px;
          align-items: center;
          flex-shrink: 0;
        }

        .input-field {
          flex: 1;
          padding: 12px 16px;
          font-size: 13.5px;
          font-family: var(--font);
          background: var(--surface2);
          border: 1px solid var(--border2);
          border-radius: var(--radius);
          color: var(--text1);
          transition: border-color 0.18s, box-shadow 0.18s;
          outline: none;
        }

        .input-field:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(79,142,247,0.12);
        }

        .input-field::placeholder { color: var(--text3); }
        .input-field:disabled { opacity: 0.4; cursor: not-allowed; }

        .send-btn {
          padding: 12px 22px;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: var(--radius);
          font-size: 13px;
          font-weight: 700;
          font-family: var(--font);
          cursor: pointer;
          transition: all 0.18s;
          letter-spacing: 0.02em;
          flex-shrink: 0;
          white-space: nowrap;
        }

        .send-btn:hover:not(:disabled) {
          background: #3a7ae4;
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(79,142,247,0.35);
        }

        .send-btn:active:not(:disabled) { transform: translateY(0); }
        .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── SHEET PANEL ── */
        .sheet-scroll {
          flex: 1;
          overflow-y: auto;
          background: var(--bg);
        }

        .sheet-scroll::-webkit-scrollbar { width: 4px; }
        .sheet-scroll::-webkit-scrollbar-track { background: transparent; }
        .sheet-scroll::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

        .sheet-table-wrap { overflow-x: auto; }

        .sheet-table {
          width: 100%;
          border-collapse: collapse;
          background: var(--surface);
        }

        .sheet-table th {
          background: var(--surface2);
          padding: 10px 14px;
          font-size: 11px;
          font-weight: 700;
          color: var(--text3);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border-bottom: 2px solid var(--border2);
          position: sticky;
          top: 0;
          z-index: 2;
          white-space: nowrap;
        }

        .sheet-table td {
          padding: 10px 14px;
          font-size: 12px;
          font-family: var(--mono);
          color: var(--text1);
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }

        .sheet-table tr:last-child td { border-bottom: none; }
        .sheet-table tbody tr:hover { background: var(--surface2); }

        /* ── LOADING / ERROR STATES ── */
        .center-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 48px;
          background: var(--bg);
        }

        .spinner {
          width: 36px;
          height: 36px;
          border: 2px solid var(--border2);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .state-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text2);
        }

        .state-desc {
          font-size: 12px;
          color: var(--text3);
          text-align: center;
          max-width: 320px;
          line-height: 1.6;
        }

        /* ── RESPONSIVE ── */
        @media (max-width: 900px) {
          .main-content { grid-template-columns: 1fr; }
          .panel:last-child { display: none; }
        }

        @media (max-width: 600px) {
          .header { padding: 0 16px; }
          .chat-scroll { padding: 14px; }
          .input-bar { padding: 12px 14px; }
          .send-btn { padding: 12px 16px; }
        }
      `}</style>

      {/* ── HEADER ── */}
      <header className="header">
        <div className="header-left">
          <div className="logo-mark">IN</div>
          <h1>Inventory Assistant</h1>
        </div>
        <div className="header-right">
          <button
            className="server-btn"
            onClick={wakeServer}
            disabled={serverStatus === "checking"}
          >
            {serverStatus === "checking" ? "Checking..." :
              serverStatus === "online" ? "✓ Server Online" :
                serverStatus === "offline" ? "✗ Offline — Retry" :
                  "Wake Server"}
          </button>
          <div
            className="status-pill"
            style={{
              background: serverStatus === "online" ? "rgba(111,255,176,0.08)" :
                serverStatus === "offline" ? "rgba(255,107,107,0.08)" :
                  "rgba(139,146,168,0.08)",
              color: serverStatus === "online" ? "var(--accent2)" :
                serverStatus === "offline" ? "var(--accent3)" :
                  "var(--text2)",
            }}
          >
            <div
              className={`status-dot ${serverStatus !== "idle" ? "pulse" : ""}`}
              style={{
                background: serverStatus === "online" ? "var(--accent2)" :
                  serverStatus === "offline" ? "var(--accent3)" :
                    "var(--text3)",
              }}
            />
            {serverStatus === "online" ? "Online" :
              serverStatus === "offline" ? "Offline" :
                serverStatus === "checking" ? "Checking" :
                  "Unknown"}
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <div className="main-content">

        {/* ── CHAT PANEL ── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-label">Chat Assistant</span>
          </div>

          <div className="chat-scroll">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💬</div>
                <div className="empty-title">Start a Conversation</div>
                <div className="empty-desc">
                  Ask questions about your inventory, request reports, or explore product details.
                </div>
              </div>
            ) : (
              <>
                {messages.map(m => {
                  const isExpanded = expandedTables.has(m.id);
                  const hasTable = m.role === "bot" && m.table && m.table.length > 0;
                  const columns = hasTable ? Object.keys(m.table![0]) : [];

                  return (
                    <div key={m.id} className={`msg-group ${m.role}`}>
                      <div className="msg-meta">
                        <span className="msg-role">{m.role === "user" ? "You" : "Assistant"}</span>
                        <span className="msg-time">{formatTime(m.timestamp)}</span>
                      </div>

                      <div className={`msg-bubble ${m.role}${m.status === "error" ? " error" : ""}`}>
                        {m.text}
                      </div>

                      {/* Table toggle button */}
                      {hasTable && (
                        <button
                          className={`table-toggle-btn ${isExpanded ? "open" : ""}`}
                          onClick={() => toggleTable(m.id)}
                        >
                          📊 {isExpanded ? "Hide" : "View"} Data Table
                          <span style={{ fontFamily: "var(--mono)", opacity: 0.7 }}>
                            ({m.table!.length} {m.table!.length === 1 ? "row" : "rows"})
                          </span>
                          <span className="arrow">▼</span>
                        </button>
                      )}

                      {/* Inline table */}
                      {hasTable && isExpanded && (
                        <div className="inline-table-wrap">
                          <div className="inline-table-header">
                            <span className="inline-table-title">Inventory Data</span>
                            <span className="inline-table-count">
                              {m.table!.length} {m.table!.length === 1 ? "row" : "rows"}
                            </span>
                          </div>
                          <div className="inline-table-scroll">
                            <table>
                              <thead>
                                <tr>{columns.map(col => <th key={col}>{col}</th>)}</tr>
                              </thead>
                              <tbody>
                                {m.table!.map((row, ri) => (
                                  <tr key={ri}>
                                    {columns.map(col => (
                                      <td key={col}>
                                        {row[col] === null || row[col] === undefined
                                          ? "—"
                                          : String(row[col])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Typing indicator */}
                {loading && (
                  <div className="msg-group bot">
                    <div className="msg-meta">
                      <span className="msg-role">Assistant</span>
                    </div>
                    <div className="typing-wrap">
                      <div className="typing-dots">
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                      </div>
                      <span className="typing-label">Processing</span>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div className="input-bar">
            <input
              ref={inputRef}
              className="input-field"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask about inventory..."
              disabled={loading}
              autoComplete="off"
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
            >
              {loading ? "Sending…" : "Send →"}
            </button>
          </div>
        </div>

        {/* ── SHEET PANEL ── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-label">Live Inventory Data</span>
            <button
              className="refresh-btn"
              onClick={fetchGoogleSheetData}
              disabled={sheetLoading}
            >
              {sheetLoading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>

          {sheetLoading ? (
            <div className="center-state">
              <div className="spinner" />
              <div className="state-title">Loading sheet data…</div>
            </div>
          ) : sheetError ? (
            <div className="center-state">
              <div style={{ fontSize: 32 }}>⚠️</div>
              <div className="state-title">Unable to Load Data</div>
              <div className="state-desc">{sheetError}</div>
              <button className="refresh-btn" onClick={fetchGoogleSheetData}>
                Try Again
              </button>
            </div>
          ) : sheetData.length > 0 ? (
            <div className="sheet-scroll">
              <div className="sheet-table-wrap">
                <table className="sheet-table">
                  <thead>
                    <tr>
                      {Object.keys(sheetData[0]).map(col => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheetData.map((row, i) => (
                      <tr key={i}>
                        {Object.keys(sheetData[0]).map(col => (
                          <td key={col}>{row[col]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="center-state">
              <div style={{ fontSize: 32 }}>📋</div>
              <div className="state-title">No Data Available</div>
              <div className="state-desc">
                The sheet appears to be empty or couldn't be loaded.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}