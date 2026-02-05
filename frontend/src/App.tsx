import { useState, useRef, useEffect } from "react";
import ReactMarkdown from 'react-markdown';

const AGENT_ID = import.meta.env.VITE_DAEMO_AGENT_ID;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const API_KEY = import.meta.env.VITE_DAEMO_API_KEY;
const GOOGLE_SHEET_ID = "10nSkephAlzBd4qDkPTBfx6C1zVRJGRrWNiKtHBq47jw";

type MessageContent = {
  type: 'text' | 'table' | 'jsx' | 'markdown' | 'card' | 'error';
  data: any;
};

type Message = {
  role: "user" | "bot";
  content: MessageContent[];
  timestamp: Date;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sheetData, setSheetData] = useState<any[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [serverStatus, setServerStatus] = useState<
    "idle" | "checking" | "online" | "offline"
  >("idle");

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    wakeServer();
    fetchGoogleSheetData();
  }, []);

  async function fetchGoogleSheetData() {
    setSheetLoading(true);
    setSheetError(null);

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=0`;
      const response = await fetch(csvUrl);

      if (!response.ok) {
        throw new Error("Failed to fetch sheet data. Make sure the sheet is published to the web.");
      }

      const csvText = await response.text();
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

      if (rows.length > 1) {
        const headers = rows[0];
        const data = rows.slice(1).filter(row => row.some(cell => cell)).map(row => {
          const obj: any = {};
          headers.forEach((header, index) => {
            obj[header] = row[index] || "";
          });
          return obj;
        });
        setSheetData(data);
      }
    } catch (error) {
      console.error("Error fetching Google Sheet:", error);
      setSheetError(error instanceof Error ? error.message : "Failed to load sheet data");
    } finally {
      setSheetLoading(false);
    }
  }

  async function wakeServer() {
    try {
      setServerStatus("checking");
      const res = await fetch(`${BACKEND_URL}/`);
      if (!res.ok) throw new Error("Server not responding");
      const data = await res.json();
      console.log("✅ Server health:", data);
      setServerStatus("online");
    } catch (err) {
      console.error("❌ Wake failed:", err);
      setServerStatus("offline");
    }
  }

  function parseJSXContent(jsx: string): any {
    // Extract structured data from JSX if possible
    try {
      // Look for common patterns in the JSX
      const cardPattern = /<Card>[\s\S]*?<\/Card>/g;
      const matches = jsx.match(cardPattern);

      if (matches) {
        const cards = matches.map(card => {
          const titleMatch = card.match(/<CardTitle>(.*?)<\/CardTitle>/);
          const descMatch = card.match(/<CardDescription>(.*?)<\/CardDescription>/);
          const contentMatch = card.match(/<CardContent>([\s\S]*?)<\/CardContent>/);

          let fields: any = {};
          let value = '';
          let subtitle = '';

          if (contentMatch) {
            const content = contentMatch[1];

            // Look for field patterns: <p><strong>Field:</strong> Value</p>
            const fieldMatches = content.matchAll(/<p><strong>(.*?):<\/strong>\s*(.*?)<\/p>/g);
            for (const match of fieldMatches) {
              fields[match[1]] = match[2];
            }

            // Look for large value pattern: <p className="text-3xl...">Value</p>
            const valueMatch = content.match(/<p className="text-3xl[^"]*">(.*?)<\/p>/);
            if (valueMatch) {
              value = valueMatch[1];
            }

            // Look for subtitle pattern: <p className="text-sm...">Subtitle</p>
            const subtitleMatch = content.match(/<p className="text-sm[^"]*">(.*?)<\/p>/);
            if (subtitleMatch) {
              subtitle = subtitleMatch[1];
            }
          }

          return {
            title: titleMatch ? titleMatch[1].replace(/[💰💵📦📊⚠️🚫]/g, '').trim() : '',
            description: descMatch ? descMatch[1] : '',
            fields,
            value,
            subtitle
          };
        }).filter(card => card.title || card.value); // Only keep cards with content

        return cards;
      }
    } catch (e) {
      console.warn("Failed to parse JSX:", e);
    }

    return null;
  }

  function parseDaemoResponse(data: any): MessageContent[] {
    const contents: MessageContent[] = [];

    // 1. Handle direct text response (highest priority)
    if (data?.text) {
      contents.push({
        type: 'text',
        data: data.text
      });
    }

    // 2. Handle JSX response
    if (data?.jsx) {
      const parsedCards = parseJSXContent(data.jsx);
      if (parsedCards) {
        contents.push({
          type: 'card',
          data: parsedCards
        });
      }
    }

    // 3. Handle tool interactions and stored data (only if no text response exists)
    if (!data?.text && Array.isArray(data?.toolInteractions)) {
      for (const tool of data.toolInteractions) {
        const stored = tool?.result?.stored;

        if (Array.isArray(stored)) {
          for (const item of stored) {
            if (item?.preview) {
              try {
                let parsed = typeof item.preview === "string"
                  ? JSON.parse(item.preview)
                  : item.preview;

                // Normalize single objects to arrays
                if (!Array.isArray(parsed) && typeof parsed === "object") {
                  parsed = [parsed];
                }

                // If it's an array of objects, treat as table
                if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
                  contents.push({
                    type: 'table',
                    data: {
                      title: item.var_name || 'Data',
                      rows: parsed
                    }
                  });
                }
              } catch (e) {
                console.warn("Failed to parse preview:", e);
              }
            }
          }
        }
      }
    }

    // 4. If no content was parsed, show error
    if (contents.length === 0) {
      contents.push({
        type: 'error',
        data: 'No readable response received from the assistant.'
      });
    }

    return contents;
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: [{ type: 'text', data: input }],
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      // const url = `https://backend.daemo.ai/agents/${AGENT_ID}/query`;
      const url = `${BACKEND_URL}/agent/query-stream`
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ query: userMessage.content[0].data }),
      });

      const rawText = await res.text();
      let data: any;

      try {
        data = JSON.parse(rawText);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "bot",
            content: [{ type: 'error', data: 'Unable to process server response. Please try again.' }],
            timestamp: new Date(),
          },
        ]);
        setLoading(false);
        return;
      }

      const parsedContent = parseDaemoResponse(data);

      const botMessage: Message = {
        role: "bot",
        content: parsedContent,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          content: [{ type: 'error', data: 'Connection error. Please check your network and try again.' }],
          timestamp: new Date(),
        },
      ]);
    }

    setLoading(false);
  }

  function formatTime(date: Date) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function renderContent(content: MessageContent) {
    switch (content.type) {
      case 'text':
        return <div className="message-text">{content.data}</div>;

      case 'markdown':
        return (
          <div className="message-markdown">
            <ReactMarkdown>{content.data}</ReactMarkdown>
          </div>
        );

      case 'table':
        return (
          <div className="message-table">
            <div className="table-header">
              <div className="table-title">{content.data.title}</div>
              <div className="table-count">
                {content.data.rows.length} {content.data.rows.length === 1 ? 'item' : 'items'}
              </div>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    {Object.keys(content.data.rows[0]).map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {content.data.rows.map((row: any, i: number) => (
                    <tr key={i}>
                      {Object.keys(content.data.rows[0]).map((col) => (
                        <td key={col}>{String(row[col])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'card':
        return (
          <div className="message-cards">
            {content.data.map((card: any, i: number) => (
              <div key={i} className="info-card">
                {card.title && <div className="card-title">{card.title}</div>}
                {card.description && <div className="card-description">{card.description}</div>}

                {/* Large value display */}
                {card.value && (
                  <div className="card-value-large">
                    {card.value}
                  </div>
                )}

                {/* Subtitle under value */}
                {card.subtitle && (
                  <div className="card-subtitle">{card.subtitle}</div>
                )}

                {/* Field/value pairs */}
                {Object.keys(card.fields).length > 0 && (
                  <div className="card-fields">
                    {Object.entries(card.fields).map(([key, value]) => (
                      <div key={key} className="card-field">
                        <span className="field-label">{key}:</span>
                        <span className="field-value">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        );

      case 'jsx':
        return (
          <div className="message-code">
            <pre><code>{content.data}</code></pre>
          </div>
        );

      case 'error':
        return (
          <div className="message-error">
            <span className="error-icon">⚠️</span>
            {content.data}
          </div>
        );

      default:
        return <div className="message-text">{JSON.stringify(content.data)}</div>;
    }
  }

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        :root {
          --primary: #0F172A;
          --primary-light: #1E293B;
          --primary-lighter: #334155;
          --accent: #3B82F6;
          --accent-hover: #2563EB;
          --accent-light: #DBEAFE;
          --background: #F8FAFC;
          --surface: #FFFFFF;
          --text-primary: #0F172A;
          --text-secondary: #64748B;
          --text-tertiary: #94A3B8;
          --border: #E2E8F0;
          --border-light: #F1F5F9;
          --success: #10B981;
          --success-light: #D1FAE5;
          --warning: #F59E0B;
          --warning-light: #FEF3C7;
          --error: #EF4444;
          --error-light: #FEE2E2;
          --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          --shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          --radius: 12px;
          --radius-sm: 8px;
          --radius-lg: 16px;
        }

        body {
          font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
          background: var(--background);
          color: var(--text-primary);
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .app {
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--background);
        }

        .header {
          background: var(--surface);
          padding: 20px 32px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: relative;
          z-index: 10;
        }

        .header::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 32px;
          right: 32px;
          height: 2px;
          background: linear-gradient(90deg, var(--accent) 0%, transparent 100%);
          opacity: 0.6;
        }

        .header-content {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .logo {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, var(--accent) 0%, #8B5CF6 100%);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: white;
          font-size: 18px;
        }

        .header h1 {
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--text-primary);
        }

        .status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: var(--success-light);
          border-radius: 100px;
          font-size: 13px;
          font-weight: 500;
          color: var(--success);
        }

        .status-dot {
          width: 6px;
          height: 6px;
          background: var(--success);
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .main-content {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: var(--border);
          overflow: hidden;
        }

        .panel {
          background: var(--surface);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .panel-header {
          padding: 16px 24px;
          border-bottom: 1px solid var(--border);
          background: var(--background);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .panel-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .refresh-button {
          padding: 6px 12px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: 'Outfit', sans-serif;
        }

        .refresh-button:hover {
          background: var(--background);
          border-color: var(--accent);
          color: var(--accent);
        }

        .chat-container {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .chat-container::-webkit-scrollbar,
        .sheet-container::-webkit-scrollbar {
          width: 8px;
        }

        .chat-container::-webkit-scrollbar-track,
        .sheet-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .chat-container::-webkit-scrollbar-thumb,
        .sheet-container::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 100px;
        }

        .chat-container::-webkit-scrollbar-thumb:hover,
        .sheet-container::-webkit-scrollbar-thumb:hover {
          background: var(--text-tertiary);
        }

        .message-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
          animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .message-group.user {
          align-items: flex-end;
        }

        .message-group.bot {
          align-items: flex-start;
        }

        .message-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 4px;
        }

        .message-role {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .message-time {
          font-size: 11px;
          color: var(--text-tertiary);
          font-weight: 400;
        }

        .message {
          max-width: 85%;
          border-radius: var(--radius);
          position: relative;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .message.user {
          background: var(--accent);
          color: white;
          padding: 14px 18px;
          border-bottom-right-radius: 4px;
          box-shadow: var(--shadow);
        }

        .message.bot {
          width: 100%;
          max-width: 100%;
        }

        .message-text {
          padding: 14px 18px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          line-height: 1.6;
          font-size: 14px;
          white-space: pre-wrap;
        }

        .message-markdown {
          padding: 14px 18px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          line-height: 1.6;
          font-size: 14px;
        }

        .message-markdown pre {
          background: var(--primary);
          color: #e2e8f0;
          padding: 12px;
          border-radius: var(--radius-sm);
          overflow-x: auto;
          margin: 8px 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
        }

        .message-markdown code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
        }

        .message-markdown p {
          margin: 8px 0;
        }

        .message-markdown strong {
          color: var(--text-primary);
          font-weight: 600;
        }

        .message-table {
          background: var(--surface);
          border-radius: var(--radius);
          border: 1px solid var(--border);
          overflow: hidden;
          box-shadow: var(--shadow);
          width: 100%;
        }

        .table-header {
          padding: 12px 16px;
          background: linear-gradient(to right, var(--primary), var(--primary-light));
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .table-title {
          font-size: 14px;
          font-weight: 600;
          color: white;
          letter-spacing: -0.01em;
        }

        .table-count {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .table-wrapper {
          overflow-x: auto;
          max-height: 400px;
          overflow-y: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th {
          background: var(--background);
          padding: 10px 14px;
          text-align: left;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 2px solid var(--border);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        td {
          padding: 10px 14px;
          font-size: 13px;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border-light);
          font-family: 'JetBrains Mono', monospace;
        }

        tr:last-child td {
          border-bottom: none;
        }

        tbody tr {
          transition: background 0.15s ease;
        }

        tbody tr:hover {
          background: var(--background);
        }

        .message-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 12px;
          width: 100%;
        }

        .info-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 16px;
          box-shadow: var(--shadow-sm);
          transition: all 0.2s ease;
        }

        .info-card:hover {
          box-shadow: var(--shadow);
          border-color: var(--accent);
        }

        .card-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 6px;
        }

        .card-description {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 12px;
          line-height: 1.5;
        }

        .card-value-large {
          font-size: 32px;
          font-weight: 700;
          color: var(--accent);
          margin: 12px 0 4px 0;
          font-family: 'JetBrains Mono', monospace;
        }

        .card-subtitle {
          font-size: 12px;
          color: var(--text-tertiary);
          margin-bottom: 12px;
        }

        .card-fields {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .card-field {
          display: flex;
          gap: 8px;
          font-size: 13px;
          line-height: 1.5;
        }

        .field-label {
          font-weight: 600;
          color: var(--text-secondary);
          min-width: 120px;
        }

        .field-value {
          color: var(--text-primary);
          font-family: 'JetBrains Mono', monospace;
        }

        .message-code {
          background: var(--primary);
          border-radius: var(--radius);
          padding: 14px;
          overflow-x: auto;
        }

        .message-code pre {
          margin: 0;
          color: #e2e8f0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          line-height: 1.6;
        }

        .message-error {
          padding: 14px 18px;
          background: var(--error-light);
          border: 1px solid var(--error);
          border-radius: var(--radius);
          color: var(--error);
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .error-icon {
          font-size: 18px;
        }

        .typing-indicator {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          max-width: fit-content;
        }

        .typing-dots {
          display: flex;
          gap: 6px;
        }

        .typing-dot {
          width: 7px;
          height: 7px;
          background: var(--text-tertiary);
          border-radius: 50%;
          animation: typing 1.4s ease-in-out infinite;
        }

        .typing-dot:nth-child(1) { animation-delay: 0s; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes typing {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
          30% { transform: translateY(-8px); opacity: 1; }
        }

        .typing-text {
          font-size: 13px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .input-container {
          padding: 20px 24px;
          background: var(--surface);
          border-top: 1px solid var(--border);
          display: flex;
          gap: 12px;
          align-items: flex-end;
        }

        .input-wrapper {
          flex: 1;
          position: relative;
        }

        .input {
          width: 100%;
          padding: 14px 18px;
          font-size: 14px;
          border: 2px solid var(--border);
          border-radius: var(--radius);
          font-family: 'Outfit', sans-serif;
          background: var(--surface);
          color: var(--text-primary);
          transition: all 0.2s ease;
          resize: none;
          line-height: 1.5;
        }

        .input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 4px var(--accent-light);
        }

        .input::placeholder {
          color: var(--text-tertiary);
        }

        .send-button {
          padding: 14px 28px;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius);
          cursor: pointer;
          font-family: 'Outfit', sans-serif;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.2s ease;
          box-shadow: var(--shadow);
        }

        .send-button:hover:not(:disabled) {
          background: var(--accent-hover);
          transform: translateY(-1px);
          box-shadow: var(--shadow-lg);
        }

        .send-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .send-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--text-tertiary);
          padding: 40px;
        }

        .empty-icon {
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, var(--accent-light) 0%, var(--border-light) 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          margin-bottom: 8px;
        }

        .empty-title {
          font-size: 17px;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .empty-description {
          font-size: 14px;
          color: var(--text-tertiary);
          text-align: center;
          max-width: 350px;
          line-height: 1.5;
        }

        .sheet-container {
          flex: 1;
          overflow-y: auto;
          background: var(--background);
        }

        .sheet-wrapper {
          overflow-x: auto;
        }

        .sheet-table {
          width: 100%;
          border-collapse: collapse;
          background: var(--surface);
        }

        .sheet-loading {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 48px;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .sheet-error {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 48px;
        }

        .error-icon-large {
          width: 64px;
          height: 64px;
          background: var(--error-light);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--error);
          font-size: 28px;
          font-weight: 700;
        }

        .error-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .error-message {
          font-size: 13px;
          color: var(--text-tertiary);
          text-align: center;
          max-width: 400px;
          line-height: 1.5;
        }

        @media (max-width: 1024px) {
          .main-content {
            grid-template-columns: 1fr;
          }

          .panel:last-child {
            display: none;
          }
        }

        @media (max-width: 768px) {
          .header {
            padding: 16px 20px;
          }

          .header h1 {
            font-size: 18px;
          }

          .message {
            max-width: 90%;
            font-size: 13px;
          }
        }
      `}</style>

      <div className="header">
        <div className="header-content">
          <div className="logo">AI</div>
          <h1>Inventory Assistant</h1>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            className="refresh-button"
            onClick={wakeServer}
            disabled={serverStatus === "checking"}
          >
            {serverStatus === "checking"
              ? "Waking..."
              : serverStatus === "online"
                ? "Server Online"
                : serverStatus === "offline"
                  ? "Server Offline"
                  : "Wake Server"}
          </button>

          <div
            className="status"
            style={{
              background:
                serverStatus === "online"
                  ? "var(--success-light)"
                  : serverStatus === "offline"
                    ? "var(--error-light)"
                    : "var(--border-light)",
              color:
                serverStatus === "online"
                  ? "var(--success)"
                  : serverStatus === "offline"
                    ? "var(--error)"
                    : "var(--text-secondary)",
            }}
          >
            <div
              className="status-dot"
              style={{
                background:
                  serverStatus === "online"
                    ? "var(--success)"
                    : serverStatus === "offline"
                      ? "var(--error)"
                      : "var(--text-tertiary)",
              }}
            ></div>

            {serverStatus === "online"
              ? "Online"
              : serverStatus === "offline"
                ? "Offline"
                : "Unknown"}
          </div>
        </div>
      </div>

      <div className="main-content">
        {/* Chat Panel */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Chat Assistant</div>
          </div>

          <div className="chat-container">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💬</div>
                <div className="empty-title">Start a Conversation</div>
                <div className="empty-description">
                  Ask questions about your inventory, request reports, or explore
                  product details.
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={i} className={`message-group ${m.role}`}>
                    <div className="message-header">
                      <span className="message-role">
                        {m.role === "user" ? "You" : "Assistant"}
                      </span>
                      <span className="message-time">{formatTime(m.timestamp)}</span>
                    </div>
                    <div className={`message ${m.role}`}>
                      {m.content.map((content, idx) => (
                        <div key={idx}>{renderContent(content)}</div>
                      ))}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="message-group bot">
                    <div className="typing-indicator">
                      <div className="typing-dots">
                        <div className="typing-dot"></div>
                        <div className="typing-dot"></div>
                        <div className="typing-dot"></div>
                      </div>
                      <span className="typing-text">Processing</span>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="input-container">
            <div className="input-wrapper">
              <input
                ref={inputRef}
                className="input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask about inventory..."
                disabled={loading}
              />
            </div>
            <button
              className="send-button"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
            >
              {loading ? "Sending..." : "Send"}
            </button>
          </div>
        </div>

        {/* Google Sheet Panel */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Live Inventory Data</div>
            <button
              className="refresh-button"
              onClick={fetchGoogleSheetData}
              disabled={sheetLoading}
            >
              {sheetLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="sheet-container">
            {sheetLoading ? (
              <div className="sheet-loading">
                <div className="spinner"></div>
                <div className="empty-title">Loading sheet data...</div>
              </div>
            ) : sheetError ? (
              <div className="sheet-error">
                <div className="error-icon-large">!</div>
                <div className="error-title">Unable to Load Data</div>
                <div className="error-message">{sheetError}</div>
                <button
                  className="refresh-button"
                  onClick={fetchGoogleSheetData}
                  style={{ marginTop: '8px' }}
                >
                  Try Again
                </button>
              </div>
            ) : sheetData.length > 0 ? (
              <div className="sheet-wrapper">
                <table className="sheet-table">
                  <thead>
                    <tr>
                      {Object.keys(sheetData[0]).map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheetData.map((row, i) => (
                      <tr key={i}>
                        {Object.keys(sheetData[0]).map((col) => (
                          <td key={col}>{row[col]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <div className="empty-title">No Data Available</div>
                <div className="empty-description">
                  The sheet appears to be empty or could not be loaded.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}