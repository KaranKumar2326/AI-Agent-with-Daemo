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
  streaming?: boolean;
};

type ServerStatus = "idle" | "checking" | "online" | "offline";

// ─── MARKDOWN RENDERER ────────────────────────────────────────────────────────
function MarkdownMessage({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  function formatInline(raw: string, key: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    const regex = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      if (match.index > last) parts.push(raw.slice(last, match.index));
      const token = match[0];
      if (token.startsWith("`")) parts.push(<code key={`${key}-c${match.index}`} className="md-code-inline">{token.slice(1, -1)}</code>);
      else if (token.startsWith("***")) parts.push(<strong key={`${key}-bi${match.index}`}><em>{token.slice(3, -3)}</em></strong>);
      else if (token.startsWith("**")) parts.push(<strong key={`${key}-b${match.index}`}>{token.slice(2, -2)}</strong>);
      else if (token.startsWith("*")) parts.push(<em key={`${key}-i${match.index}`}>{token.slice(1, -1)}</em>);
      else if (token.startsWith("~~")) parts.push(<del key={`${key}-s${match.index}`}>{token.slice(2, -2)}</del>);
      else parts.push(token);
      last = match.index + token.length;
    }
    if (last < raw.length) parts.push(raw.slice(last));
    return parts.length === 1 ? parts[0] : parts;
  }

  function parseTable(startIdx: number): { el: React.ReactNode; endIdx: number } {
    const tableLines: string[] = [];
    let j = startIdx;
    while (j < lines.length && lines[j].trim().startsWith("|")) { tableLines.push(lines[j]); j++; }
    if (tableLines.length < 2) return { el: null, endIdx: startIdx };
    const parseRow = (line: string) => line.split("|").slice(1, -1).map(c => c.trim());
    const headers = parseRow(tableLines[0]);
    const rows = tableLines.slice(2).map(parseRow);
    const el = (
      <div key={`tbl-${startIdx}`} className="md-table-wrap">
        <table className="md-table">
          <thead><tr>{headers.map((h, hi) => <th key={hi}>{formatInline(h, `th-${startIdx}-${hi}`)}</th>)}</tr></thead>
          <tbody>{rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{formatInline(cell, `td-${startIdx}-${ri}-${ci}`)}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    );
    return { el, endIdx: j };
  }

  function parseList(startIdx: number, ordered: boolean): { el: React.ReactNode; endIdx: number } {
    const items: React.ReactNode[] = [];
    let j = startIdx;
    const bulletRe = /^[-*+]\s+(.+)/;
    const orderedRe = /^\d+\.\s+(.+)/;
    while (j < lines.length) {
      const line = lines[j].trim();
      const match = (ordered ? orderedRe : bulletRe).exec(line);
      if (!match) break;
      items.push(<li key={j}>{formatInline(match[1], `li-${startIdx}-${j}`)}</li>);
      j++;
    }
    const el = ordered
      ? <ol key={`ol-${startIdx}`} className="md-ol">{items}</ol>
      : <ul key={`ul-${startIdx}`} className="md-ul">{items}</ul>;
    return { el, endIdx: j };
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { elements.push(<div key={`sp-${i}`} className="md-spacer" />); i++; continue; }
    if (/^---+$/.test(trimmed)) { elements.push(<hr key={`hr-${i}`} className="md-hr" />); i++; continue; }

    const h1m = trimmed.match(/^#\s+(.+)/);
    const h2m = trimmed.match(/^##\s+(.+)/);
    const h3m = trimmed.match(/^###\s+(.+)/);

    // Check h3 before h2 before h1 (most specific first)
    if (h3m) { elements.push(<h3 key={`h3-${i}`} className="md-h3">{formatInline(h3m[1], `h3-${i}`)}</h3>); i++; continue; }
    if (h2m) { elements.push(<h2 key={`h2-${i}`} className="md-h2">{formatInline(h2m[1], `h2-${i}`)}</h2>); i++; continue; }
    if (h1m) { elements.push(<h1 key={`h1-${i}`} className="md-h1">{formatInline(h1m[1], `h1-${i}`)}</h1>); i++; continue; }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { codeLines.push(lines[i]); i++; }
      elements.push(
        <div key={`cb-${i}`} className="md-code-block">
          {lang && <div className="md-code-lang">{lang}</div>}
          <pre><code>{codeLines.join("\n")}</code></pre>
        </div>
      );
      i++; continue;
    }

    if (trimmed.startsWith("|")) {
      const { el, endIdx } = parseTable(i);
      if (el) { elements.push(el); i = endIdx; continue; }
    }

    if (/^[-*+]\s/.test(trimmed)) {
      const { el, endIdx } = parseList(i, false);
      elements.push(el); i = endIdx; continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const { el, endIdx } = parseList(i, true);
      elements.push(el); i = endIdx; continue;
    }

    if (trimmed.startsWith("> ")) {
      elements.push(<blockquote key={`bq-${i}`} className="md-blockquote">{formatInline(trimmed.slice(2), `bq-${i}`)}</blockquote>);
      i++; continue;
    }

    elements.push(<p key={`p-${i}`} className="md-p">{formatInline(trimmed, `p-${i}`)}</p>);
    i++;
  }

  return <div className={`md-body${streaming ? " md-streaming" : ""}`}>{elements}</div>;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function safeParsePreview(preview: unknown): any {
  if (preview === null || preview === undefined) return null;
  if (typeof preview === "object") return preview;
  if (typeof preview !== "string") return null;
  const str = preview.trim();
  if (!str || str === "[]" || str === "{}") return null;
  try { return JSON.parse(str); } catch { /* no-op */ }
  try { return Function('"use strict"; return (' + str + ')')(); } catch { return null; }
}

const SUMMARY_KEYS = new Set(["totalProducts", "totalQuantity", "totalValue", "lowStockCount", "outOfStockCount", "executionTime", "meta", "status", "error", "functionsUsed"]);

function isSummaryObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  return keys.length > 0 && keys.every(k => SUMMARY_KEYS.has(k));
}

function normalizeToTable(parsed: any): any[] | null {
  if (parsed === null || parsed === undefined) return null;
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return null;
    const rows = parsed.filter(r => r && typeof r === "object");
    return rows.length > 0 ? rows : null;
  }
  if (typeof parsed !== "object") return null;
  const { meta, ...rest } = parsed as any;
  if (Object.keys(rest).length === 0) return null;
  return [rest];
}

function extractTextFromJSX(jsx: string): string {
  const lines: string[] = [];
  const titles = [...jsx.matchAll(/<CardTitle[^>]*>([\s\S]*?)<\/CardTitle>/g)];
  const descriptions = [...jsx.matchAll(/<CardDescription[^>]*>([\s\S]*?)<\/CardDescription>/g)];
  const paragraphs = [...jsx.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  const boldDivs = [...jsx.matchAll(/<div[^>]*font-bold[^>]*>([\s\S]*?)<\/div>/g)];
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (titles.length > 0) lines.push(stripTags(titles[0][1]));
  const subTitles = titles.slice(1).map(m => stripTags(m[1]));
  const boldValues = boldDivs.map(m => stripTags(m[1]));
  subTitles.forEach((title, i) => { const val = boldValues[i]; lines.push(val ? `${title}: ${val}` : title); });
  [...descriptions, ...paragraphs].forEach(m => {
    const t = stripTags(m[1]);
    if (t && !lines.some(l => l.includes(t.slice(0, 30)))) lines.push(t);
  });
  if (lines.length > 0) return lines.join("\n");
  return jsx.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTable(data: any): any[] | null {
  let table: any[] | null = null;
  if (!Array.isArray(data?.toolInteractions)) return null;
  for (const tool of data.toolInteractions) {
    const stored: any[] | undefined = tool?.result?.stored;
    if (Array.isArray(stored)) {
      for (const item of stored) {
        if (!item?.preview) continue;
        const parsed = safeParsePreview(item.preview);
        if (parsed === null) continue;
        const normalized = normalizeToTable(parsed);
        if (normalized && normalized.length > 0) {
          const firstRow = normalized[0];
          if (typeof firstRow === "object" && !isSummaryObject(firstRow)) table = normalized;
          else if (!table) table = normalized;
        }
      }
    }
    const result = tool?.result?.result;
    if (!table && result && typeof result === "object" && !result?.error) {
      const { meta, ...clean } = result as any;
      if (Object.keys(clean).length > 0) table = [clean];
    }
  }
  return table;
}

function extractText(data: any): string {
  if (typeof data?.text === "string" && data.text.trim()) return data.text.trim();
  if (typeof data?.jsx === "string" && data.jsx.trim()) return extractTextFromJSX(data.jsx);
  return "";
}

function parseCSV(csvText: string): any[] {
  const rows = csvText.split("\n").map(row => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; }
      else { current += char; }
    }
    values.push(current.trim());
    return values;
  });
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).filter(row => row.some(cell => cell.trim())).map(row => {
    const obj: any = {};
    headers.forEach((header, index) => { obj[header] = row[index] ?? ""; });
    return obj;
  });
}

function genId(): string { return Math.random().toString(36).slice(2, 10); }

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [threadId, setThreadId] = useState<string | null>(() => sessionStorage.getItem("daemo_thread_id") || null);
  const [sheetData, setSheetData] = useState<any[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("idle");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, expandedTables]);
  useEffect(() => { wakeServer(); fetchGoogleSheetData(); }, []);
  useEffect(() => {
    if (threadId) sessionStorage.setItem("daemo_thread_id", threadId);
    else sessionStorage.removeItem("daemo_thread_id");
  }, [threadId]);

  async function wakeServer() {
    setServerStatus("checking");
    try {
      const res = await fetch(`${BACKEND_URL}/`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("Non-OK");
      setServerStatus("online");
    } catch { setServerStatus("offline"); }
  }

  const fetchGoogleSheetData = useCallback(async () => {
    setSheetLoading(true); setSheetError(null);
    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=0`;
      const response = await fetch(csvUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Failed to fetch. Make sure the sheet is published to web.");
      setSheetData(parseCSV(await response.text()));
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : "Failed to load sheet data");
    } finally { setSheetLoading(false); }
  }, []);

  function clearSession() { setMessages([]); setThreadId(null); setExpandedTables(new Set()); }

  function toggleTable(id: string) {
    setExpandedTables(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function sendMessage() {
    const query = input.trim();
    if (!query || loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: Message = { id: genId(), role: "user", text: query, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const botId = genId();
    setMessages(prev => [...prev, { id: botId, role: "bot", text: "", timestamp: new Date(), streaming: true, status: "ok" }]);

    try {
      const url = `https://backend.daemo.ai/agents/${AGENT_ID}/query-stream`;
      const body: Record<string, any> = { query };
      if (threadId) body.threadId = threadId;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Server responded with status ${res.status}`);
      if (!res.body) throw new Error("No response body for streaming");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let finalTable: any[] | null = null;
      let newThreadId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
          if (!jsonStr) continue;
          let chunk: any;
          try { chunk = JSON.parse(jsonStr); } catch { continue; }
          if (chunk?.threadId && !newThreadId) newThreadId = chunk.threadId;
          if (typeof chunk?.delta === "string") accumulatedText += chunk.delta;
          else if (typeof chunk?.text === "string" && chunk.text.trim()) accumulatedText = chunk.text.trim();
          else if (typeof chunk?.jsx === "string") accumulatedText = extractTextFromJSX(chunk.jsx);
          const chunkTable = extractTable(chunk);
          if (chunkTable) finalTable = chunkTable;
          if (accumulatedText) {
            setMessages(prev => prev.map(m => m.id === botId ? { ...m, text: accumulatedText, table: finalTable } : m));
          }
        }
      }

      if (buffer.trim() && buffer.trim() !== "data: [DONE]") {
        const jsonStr = buffer.trim().startsWith("data: ") ? buffer.trim().slice(6) : buffer.trim();
        try {
          const chunk = JSON.parse(jsonStr);
          if (chunk?.threadId && !newThreadId) newThreadId = chunk.threadId;
          const t = extractText(chunk); if (t) accumulatedText = t;
          const tbl = extractTable(chunk); if (tbl) finalTable = tbl;
        } catch { /* ignore */ }
      }

      if (newThreadId) setThreadId(newThreadId);

      const finalText = accumulatedText.trim() ||
        (finalTable ? `Found ${finalTable.length} result${finalTable.length !== 1 ? "s" : ""}.` : "⚠️ No response received.");

      setMessages(prev => prev.map(m =>
        m.id === botId ? { ...m, text: finalText, table: finalTable, streaming: false, status: "ok" } : m
      ));
    } catch (err: any) {
      if (err?.name === "AbortError") { setMessages(prev => prev.filter(m => m.id !== botId)); return; }
      const errorText = err?.name === "TimeoutError"
        ? "⏱ Request timed out. Please try again."
        : err?.message ? `Error: ${err.message}` : "Connection error. Please try again.";
      setMessages(prev => prev.map(m => m.id === botId ? { ...m, text: errorText, streaming: false, status: "error" } : m));
    } finally { setLoading(false); }
  }

  function formatTime(date: Date) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
        :root {
          --bg:#0C0E12; --surface:#13161D; --surface2:#1A1E27; --surface3:#222733;
          --border:#2A2F3E; --border2:#333848;
          --accent:#4F8EF7; --accent2:#6FFFB0; --accent3:#FF6B6B;
          --text1:#EEF0F6; --text2:#8B92A8; --text3:#555D72;
          --radius:10px; --radius-lg:16px; --shadow:0 4px 24px rgba(0,0,0,0.4);
          --font:'Syne',sans-serif; --mono:'DM Mono',monospace;
        }
        body { font-family:var(--font); background:var(--bg); color:var(--text1); -webkit-font-smoothing:antialiased; }
        .app { height:100vh; display:flex; flex-direction:column; overflow:hidden; }

        /* HEADER */
        .header { background:var(--surface); border-bottom:1px solid var(--border); padding:0 28px; height:60px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; z-index:20; }
        .header-left { display:flex; align-items:center; gap:12px; }
        .logo-mark { width:34px; height:34px; background:linear-gradient(135deg,var(--accent),var(--accent2)); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:800; color:var(--bg); letter-spacing:-1px; }
        .header h1 { font-size:16px; font-weight:700; color:var(--text1); letter-spacing:-0.02em; }
        .header-right { display:flex; align-items:center; gap:8px; }
        .hdr-btn { padding:6px 14px; background:var(--surface2); border:1px solid var(--border2); border-radius:var(--radius); color:var(--text2); font-size:12px; font-weight:600; font-family:var(--font); cursor:pointer; transition:all 0.18s; }
        .hdr-btn:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
        .hdr-btn:disabled { opacity:0.5; cursor:not-allowed; }
        .hdr-btn.danger:hover { border-color:var(--accent3); color:var(--accent3); }
        .status-pill { display:flex; align-items:center; gap:7px; padding:5px 12px; border-radius:100px; font-size:12px; font-weight:600; letter-spacing:0.02em; }
        .status-dot { width:6px; height:6px; border-radius:50%; }
        .status-dot.pulse { animation:sPulse 2s ease-in-out infinite; }
        @keyframes sPulse { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.5;transform:scale(0.8);} }
        .thread-badge { display:flex; align-items:center; gap:5px; padding:4px 10px; border-radius:100px; background:rgba(79,142,247,0.08); border:1px solid rgba(79,142,247,0.2); font-size:11px; font-weight:600; color:var(--accent); font-family:var(--mono); max-width:140px; overflow:hidden; }
        .thread-dot { width:5px; height:5px; border-radius:50%; background:var(--accent); flex-shrink:0; animation:sPulse 2s ease-in-out infinite; }
        .thread-id { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        /* LAYOUT */
        .main-content { flex:1; display:grid; grid-template-columns:1fr 1fr; overflow:hidden; }
        .panel { display:flex; flex-direction:column; overflow:hidden; border-right:1px solid var(--border); }
        .panel:last-child { border-right:none; }
        .panel-header { padding:12px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; background:var(--surface); flex-shrink:0; }
        .panel-label { font-size:11px; font-weight:700; color:var(--text3); text-transform:uppercase; letter-spacing:0.1em; }
        .refresh-btn { padding:5px 12px; background:transparent; border:1px solid var(--border2); border-radius:6px; color:var(--text2); font-size:11px; font-weight:600; font-family:var(--font); cursor:pointer; transition:all 0.18s; }
        .refresh-btn:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
        .refresh-btn:disabled { opacity:0.4; cursor:not-allowed; }

        /* CHAT */
        .chat-scroll { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px; background:var(--bg); }
        .chat-scroll::-webkit-scrollbar { width:4px; }
        .chat-scroll::-webkit-scrollbar-thumb { background:var(--border2); border-radius:4px; }
        .empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:40px; animation:fadeIn 0.4s ease; }
        .empty-icon { font-size:36px; margin-bottom:4px; opacity:0.6; }
        .empty-title { font-size:15px; font-weight:700; color:var(--text2); }
        .empty-desc { font-size:13px; color:var(--text3); text-align:center; max-width:280px; line-height:1.6; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:translateY(0);} }

        /* MESSAGES */
        .msg-group { display:flex; flex-direction:column; gap:5px; animation:msgIn 0.25s ease-out; }
        @keyframes msgIn { from{opacity:0;transform:translateY(6px);} to{opacity:1;transform:translateY(0);} }
        .msg-group.user { align-items:flex-end; }
        .msg-group.bot  { align-items:flex-start; }
        .msg-meta { display:flex; align-items:center; gap:7px; padding:0 3px; }
        .msg-role { font-size:11px; font-weight:700; color:var(--text3); text-transform:uppercase; letter-spacing:0.06em; }
        .msg-time { font-size:11px; color:var(--text3); font-family:var(--mono); }

        .msg-bubble { max-width:88%; padding:14px 18px; border-radius:var(--radius-lg); font-size:13.5px; line-height:1.65; word-break:break-word; }
        .msg-bubble.user { background:var(--accent); color:#fff; border-bottom-right-radius:4px; box-shadow:0 2px 12px rgba(79,142,247,0.25); white-space:pre-wrap; }
        .msg-bubble.bot { background:var(--surface2); color:var(--text1); border:1px solid var(--border); border-bottom-left-radius:4px; }
        .msg-bubble.bot.error { background:rgba(255,107,107,0.08); border-color:rgba(255,107,107,0.3); color:#ff9b9b; }

        /* ── MARKDOWN ── */
        .md-body { display:flex; flex-direction:column; gap:4px; }
        .md-streaming::after { content:'▋'; display:inline-block; animation:blink 0.8s step-end infinite; color:var(--accent2); margin-left:2px; font-size:13px; }
        @keyframes blink { 0%,100%{opacity:1;} 50%{opacity:0;} }

        .md-h1 { font-size:17px; font-weight:800; color:var(--text1); letter-spacing:-0.02em; margin-bottom:2px; padding-bottom:6px; border-bottom:1px solid var(--border); }
        .md-h2 { font-size:14px; font-weight:700; color:var(--text1); margin-top:4px; padding-left:8px; border-left:2px solid var(--accent); }
        .md-h3 { font-size:12px; font-weight:700; color:var(--accent2); text-transform:uppercase; letter-spacing:0.07em; margin-top:4px; }
        .md-p { font-size:13.5px; line-height:1.7; color:var(--text1); }
        .md-spacer { height:5px; }
        .md-hr { border:none; border-top:1px solid var(--border2); margin:6px 0; }

        .md-ul, .md-ol { padding-left:18px; display:flex; flex-direction:column; gap:3px; }
        .md-ul li, .md-ol li { font-size:13.5px; line-height:1.6; color:var(--text1); }
        .md-ul li::marker { color:var(--accent2); }
        .md-ol li::marker { color:var(--accent); font-weight:700; font-family:var(--mono); }

        .md-code-inline { font-family:var(--mono); font-size:12px; background:var(--surface3); color:var(--accent2); padding:1px 6px; border-radius:4px; border:1px solid var(--border2); }
        .md-code-block { background:var(--surface3); border:1px solid var(--border2); border-radius:var(--radius); overflow:hidden; margin:4px 0; }
        .md-code-lang { padding:4px 12px; font-size:10px; font-weight:700; color:var(--text3); text-transform:uppercase; letter-spacing:0.08em; background:var(--surface2); border-bottom:1px solid var(--border); font-family:var(--mono); }
        .md-code-block pre { padding:12px; overflow-x:auto; }
        .md-code-block code { font-family:var(--mono); font-size:12px; color:var(--text1); line-height:1.6; }

        .md-blockquote { border-left:3px solid var(--accent); padding:6px 12px; background:rgba(79,142,247,0.06); border-radius:0 var(--radius) var(--radius) 0; color:var(--text2); font-style:italic; font-size:13px; }

        .md-table-wrap { overflow-x:auto; border-radius:var(--radius); border:1px solid var(--border2); margin:4px 0; }
        .md-table { width:100%; border-collapse:collapse; font-size:12.5px; }
        .md-table th { background:var(--surface3); padding:8px 14px; font-size:11px; font-weight:700; color:var(--text2); text-transform:uppercase; letter-spacing:0.06em; border-bottom:2px solid var(--border2); white-space:nowrap; text-align:left; }
        .md-table td { padding:8px 14px; color:var(--text1); font-family:var(--mono); border-bottom:1px solid var(--border); white-space:nowrap; }
        .md-table tr:last-child td { border-bottom:none; }
        .md-table tbody tr:hover { background:var(--surface3); }
        .md-body strong { font-weight:700; color:var(--text1); }
        .md-body em { font-style:italic; color:var(--text2); }
        .md-body del { text-decoration:line-through; color:var(--text3); }

        /* TABLE TOGGLE */
        .table-toggle-btn { margin-top:6px; align-self:flex-start; display:flex; align-items:center; gap:8px; padding:7px 14px; background:rgba(111,255,176,0.08); border:1px solid rgba(111,255,176,0.25); border-radius:var(--radius); color:var(--accent2); font-size:12px; font-weight:700; font-family:var(--font); cursor:pointer; transition:all 0.18s; }
        .table-toggle-btn:hover { background:rgba(111,255,176,0.14); border-color:rgba(111,255,176,0.45); transform:translateY(-1px); }
        .table-toggle-btn .arrow { font-size:10px; transition:transform 0.2s; }
        .table-toggle-btn.open .arrow { transform:rotate(180deg); }

        .inline-table-wrap { margin-top:8px; width:100%; background:var(--surface2); border:1px solid var(--border2); border-radius:var(--radius-lg); overflow:hidden; box-shadow:var(--shadow); animation:msgIn 0.2s ease-out; }
        .inline-table-header { padding:10px 16px; background:var(--surface3); display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); }
        .inline-table-title { font-size:12px; font-weight:700; color:var(--text2); letter-spacing:0.04em; text-transform:uppercase; }
        .inline-table-count { font-size:11px; font-family:var(--mono); color:var(--accent2); background:rgba(111,255,176,0.1); padding:2px 8px; border-radius:20px; }
        .inline-table-scroll { overflow-x:auto; max-height:320px; overflow-y:auto; }
        .inline-table-scroll::-webkit-scrollbar { height:4px; width:4px; }
        .inline-table-scroll::-webkit-scrollbar-thumb { background:var(--border2); border-radius:4px; }
        .inline-table-scroll table { width:100%; border-collapse:collapse; }
        .inline-table-scroll th { background:var(--surface3); padding:9px 14px; font-size:11px; font-weight:700; color:var(--text3); text-transform:uppercase; letter-spacing:0.07em; border-bottom:1px solid var(--border); white-space:nowrap; position:sticky; top:0; z-index:2; }
        .inline-table-scroll td { padding:9px 14px; font-size:12px; font-family:var(--mono); color:var(--text1); border-bottom:1px solid var(--border); white-space:nowrap; }
        .inline-table-scroll tr:last-child td { border-bottom:none; }
        .inline-table-scroll tbody tr:hover { background:var(--surface3); }

        /* TYPING */
        .typing-wrap { display:flex; align-items:center; gap:10px; padding:12px 16px; background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius-lg); border-bottom-left-radius:4px; width:fit-content; }
        .typing-dots { display:flex; gap:5px; }
        .typing-dot { width:6px; height:6px; background:var(--text3); border-radius:50%; animation:tBounce 1.3s ease-in-out infinite; }
        .typing-dot:nth-child(1){animation-delay:0s;} .typing-dot:nth-child(2){animation-delay:0.18s;} .typing-dot:nth-child(3){animation-delay:0.36s;}
        @keyframes tBounce { 0%,60%,100%{transform:translateY(0);opacity:0.4;} 30%{transform:translateY(-7px);opacity:1;} }
        .typing-label { font-size:12px; font-weight:600; color:var(--text3); }

        /* INPUT */
        .input-bar { padding:16px 20px; background:var(--surface); border-top:1px solid var(--border); display:flex; gap:10px; align-items:center; flex-shrink:0; }
        .input-field { flex:1; padding:12px 16px; font-size:13.5px; font-family:var(--font); background:var(--surface2); border:1px solid var(--border2); border-radius:var(--radius); color:var(--text1); outline:none; transition:border-color 0.18s,box-shadow 0.18s; }
        .input-field:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(79,142,247,0.12); }
        .input-field::placeholder { color:var(--text3); }
        .input-field:disabled { opacity:0.4; cursor:not-allowed; }
        .send-btn { padding:12px 22px; background:var(--accent); color:#fff; border:none; border-radius:var(--radius); font-size:13px; font-weight:700; font-family:var(--font); cursor:pointer; transition:all 0.18s; flex-shrink:0; white-space:nowrap; }
        .send-btn:hover:not(:disabled) { background:#3a7ae4; transform:translateY(-1px); box-shadow:0 4px 14px rgba(79,142,247,0.35); }
        .send-btn:active:not(:disabled) { transform:translateY(0); }
        .send-btn:disabled { opacity:0.4; cursor:not-allowed; }

        /* SHEET */
        .sheet-scroll { flex:1; overflow-y:auto; background:var(--bg); }
        .sheet-scroll::-webkit-scrollbar { width:4px; }
        .sheet-scroll::-webkit-scrollbar-thumb { background:var(--border2); border-radius:4px; }
        .sheet-table-wrap { overflow-x:auto; }
        .sheet-table { width:100%; border-collapse:collapse; background:var(--surface); }
        .sheet-table th { background:var(--surface2); padding:10px 14px; font-size:11px; font-weight:700; color:var(--text3); text-transform:uppercase; letter-spacing:0.08em; border-bottom:2px solid var(--border2); position:sticky; top:0; z-index:2; white-space:nowrap; }
        .sheet-table td { padding:10px 14px; font-size:12px; font-family:var(--mono); color:var(--text1); border-bottom:1px solid var(--border); white-space:nowrap; }
        .sheet-table tr:last-child td { border-bottom:none; }
        .sheet-table tbody tr:hover { background:var(--surface2); }

        .center-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:48px; background:var(--bg); }
        .spinner { width:36px; height:36px; border:2px solid var(--border2); border-top-color:var(--accent); border-radius:50%; animation:spin 0.7s linear infinite; }
        @keyframes spin { to{transform:rotate(360deg);} }
        .state-title { font-size:14px; font-weight:700; color:var(--text2); }
        .state-desc { font-size:12px; color:var(--text3); text-align:center; max-width:320px; line-height:1.6; }

        @media(max-width:900px) { .main-content{grid-template-columns:1fr;} .panel:last-child{display:none;} .thread-badge{display:none;} }
        @media(max-width:600px) { .header{padding:0 16px;} .chat-scroll{padding:14px;} .input-bar{padding:12px 14px;} .send-btn{padding:12px 16px;} }
      `}</style>

      <header className="header">
        <div className="header-left">
          <div className="logo-mark">IN</div>
          <h1>Inventory Assistant</h1>
        </div>
        <div className="header-right">
          {threadId && (
            <div className="thread-badge" title={`Session: ${threadId}`}>
              <div className="thread-dot" /><span className="thread-id">{threadId.slice(0, 14)}…</span>
            </div>
          )}
          {messages.length > 0 && <button className="hdr-btn danger" onClick={clearSession}>+ New Chat</button>}
          <button className="hdr-btn" onClick={wakeServer} disabled={serverStatus === "checking"}>
            {serverStatus === "checking" ? "Checking…" : serverStatus === "online" ? "✓ Online" : serverStatus === "offline" ? "✗ Offline — Retry" : "Wake Server"}
          </button>
          <div className="status-pill" style={{
            background: serverStatus === "online" ? "rgba(111,255,176,0.08)" : serverStatus === "offline" ? "rgba(255,107,107,0.08)" : "rgba(139,146,168,0.08)",
            color: serverStatus === "online" ? "var(--accent2)" : serverStatus === "offline" ? "var(--accent3)" : "var(--text2)",
          }}>
            <div className={`status-dot ${serverStatus !== "idle" ? "pulse" : ""}`} style={{
              background: serverStatus === "online" ? "var(--accent2)" : serverStatus === "offline" ? "var(--accent3)" : "var(--text3)",
            }} />
            {serverStatus === "online" ? "Online" : serverStatus === "offline" ? "Offline" : serverStatus === "checking" ? "Checking" : "Unknown"}
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-label">Chat Assistant</span>
            {threadId && <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>session active</span>}
          </div>

          <div className="chat-scroll">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💬</div>
                <div className="empty-title">Start a Conversation</div>
                <div className="empty-desc">Ask questions about your inventory. Context is remembered throughout your session.</div>
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

                      <div className={["msg-bubble", m.role, m.status === "error" ? "error" : ""].filter(Boolean).join(" ")}>
                        {m.role === "user" ? (
                          m.text
                        ) : m.streaming && !m.text ? (
                          <div className="typing-wrap" style={{ border: "none", background: "transparent", padding: 0 }}>
                            <div className="typing-dots">
                              <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                            </div>
                            <span className="typing-label">Thinking…</span>
                          </div>
                        ) : (
                          <MarkdownMessage text={m.text} streaming={m.streaming} />
                        )}
                      </div>

                      {hasTable && !m.streaming && (
                        <button className={`table-toggle-btn ${isExpanded ? "open" : ""}`} onClick={() => toggleTable(m.id)}>
                          📊 {isExpanded ? "Hide" : "View"} Data Table
                          <span style={{ fontFamily: "var(--mono)", opacity: 0.7 }}>({m.table!.length} {m.table!.length === 1 ? "row" : "rows"})</span>
                          <span className="arrow">▼</span>
                        </button>
                      )}

                      {hasTable && isExpanded && (
                        <div className="inline-table-wrap">
                          <div className="inline-table-header">
                            <span className="inline-table-title">Inventory Data</span>
                            <span className="inline-table-count">{m.table!.length} {m.table!.length === 1 ? "row" : "rows"}</span>
                          </div>
                          <div className="inline-table-scroll">
                            <table>
                              <thead><tr>{columns.map(col => <th key={col}>{col}</th>)}</tr></thead>
                              <tbody>{m.table!.map((row, ri) => (
                                <tr key={ri}>{columns.map(col => (
                                  <td key={col}>{row[col] === null || row[col] === undefined ? "—" : String(row[col])}</td>
                                ))}</tr>
                              ))}</tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="input-bar">
            <input
              ref={inputRef} className="input-field" value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={threadId ? "Continue the conversation…" : "Ask about inventory…"}
              disabled={loading} autoComplete="off"
            />
            <button className="send-btn" onClick={sendMessage} disabled={loading || !input.trim()}>
              {loading ? "Sending…" : "Send →"}
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-label">Live Inventory Data</span>
            <button className="refresh-btn" onClick={fetchGoogleSheetData} disabled={sheetLoading}>
              {sheetLoading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
          {sheetLoading ? (
            <div className="center-state"><div className="spinner" /><div className="state-title">Loading…</div></div>
          ) : sheetError ? (
            <div className="center-state">
              <div style={{ fontSize: 32 }}>⚠️</div>
              <div className="state-title">Unable to Load Data</div>
              <div className="state-desc">{sheetError}</div>
              <button className="refresh-btn" onClick={fetchGoogleSheetData}>Try Again</button>
            </div>
          ) : sheetData.length > 0 ? (
            <div className="sheet-scroll">
              <div className="sheet-table-wrap">
                <table className="sheet-table">
                  <thead><tr>{Object.keys(sheetData[0]).map(col => <th key={col}>{col}</th>)}</tr></thead>
                  <tbody>{sheetData.map((row, i) => (
                    <tr key={i}>{Object.keys(sheetData[0]).map(col => <td key={col}>{row[col]}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="center-state">
              <div style={{ fontSize: 32 }}>📋</div>
              <div className="state-title">No Data Available</div>
              <div className="state-desc">The sheet appears to be empty or couldn't be loaded.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
