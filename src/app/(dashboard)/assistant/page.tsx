"use client";
import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOffline } from "@/hooks/useOffline";
import { useRouter } from "next/navigation";
import { Send, Bot, Sparkles, Trash2, ChevronDown } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
  timestamp?: Date;
}

const ASSISTANT_READ_CACHE_KEY = "mrf-assistant-chat-cache-v1";

const SUGGESTIONS = [
  "Give me a financial summary for this month",
  "Which customers have outstanding balance above $5000?",
  "Show all haji transfers done this month",
  "How much has been withdrawn by each person this year?",
  "What are total expenses in the last 30 days?",
  "Show me all payments received this week",
  "Which suppliers do we owe money to?",
  "What is current inventory level for all cities?",
];

function formatTime(date?: Date) {
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderLineWithBold(line: string, lineKey: string): React.ReactNode {
  const segments: React.ReactNode[] = [];
  let rest = line;
  let partIdx = 0;
  while (rest.length > 0) {
    const open = rest.indexOf("**");
    if (open === -1) {
      segments.push(rest);
      break;
    }
    if (open > 0) segments.push(rest.slice(0, open));
    const close = rest.indexOf("**", open + 2);
    if (close === -1) {
      segments.push(rest.slice(open));
      break;
    }
    segments.push(
      <strong key={`${lineKey}-b-${partIdx++}`}>{rest.slice(open + 2, close)}</strong>
    );
    rest = rest.slice(close + 2);
  }
  if (segments.length === 1) return segments[0];
  return <>{segments}</>;
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 px-4 py-1">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow">
        <Bot size={15} className="text-white" />
      </div>
      <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-gray-100">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "160ms" }} />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "320ms" }} />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  const renderContent = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("•") || line.startsWith("-")) {
        return (
          <div key={i} className="flex gap-2 mt-1">
            <span className="opacity-60 flex-shrink-0 mt-0.5 text-xs">•</span>
            <span>{renderLineWithBold(line.replace(/^[•\-]\s*/, ""), `l${i}`)}</span>
          </div>
        );
      }
      if (!line.trim()) return <div key={i} className="h-1.5" />;
      if (line.startsWith("# ")) {
        return (
          <p key={i} className="font-semibold text-sm mt-2 mb-1">
            {renderLineWithBold(line.slice(2), `h${i}`)}
          </p>
        );
      }
      return (
        <p key={i} className="leading-relaxed">
          {renderLineWithBold(line, `p${i}`)}
        </p>
      );
    });
  };

  if (isUser) {
    return (
      <div className="flex flex-col items-end px-4 py-0.5 group">
        <div className="max-w-[72%] flex flex-col items-end gap-1">
          <div className="bg-emerald-500 text-white px-4 py-2.5 rounded-2xl rounded-br-sm shadow-sm text-sm leading-relaxed">
            {msg.content}
          </div>
          <span className="text-[10px] text-gray-400 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(msg.timestamp)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 px-4 py-0.5 group">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow mb-4">
        <Bot size={15} className="text-white" />
      </div>
      <div className="max-w-[72%] flex flex-col gap-1">
        <div className="bg-white border border-gray-100 text-gray-800 px-4 py-2.5 rounded-2xl rounded-bl-sm shadow-sm text-sm">
          <div className="space-y-0.5">{renderContent(msg.content)}</div>
        </div>
        <span className="text-[10px] text-gray-400 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {formatTime(msg.timestamp)}
        </span>
      </div>
    </div>
  );
}

export default function AssistantPage() {
  const { user } = useAuth();
  const { isOnline } = useOffline();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ASSISTANT_READ_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Message[];
      setMessages(parsed.map((m) => ({ ...m, timestamp: m.timestamp ? new Date(m.timestamp) : undefined })));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ASSISTANT_READ_CACHE_KEY, JSON.stringify(messages.filter((m) => !m.loading)));
    } catch {}
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleScroll = () => {
    const el = chatAreaRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setShowScrollBtn(!atBottom);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;

    setInput("");
    const userMsg: Message = { role: "user", content, timestamp: new Date() };
    const loadingMsg: Message = { role: "assistant", content: "", loading: true };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setLoading(true);

    if (!isOnline) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "⚠️ Offline: assistant queries need internet. Your chat history is saved locally.", timestamp: new Date() },
      ]);
      setLoading(false);
      return;
    }

    try {
      const history = [...messages, userMsg].map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        content: m.content,
      }));

      const res = await fetch("/api/v1/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message: content, messages: history.slice(0, -1) }),
      });

      const rawText = await res.text();
      let reply: string;
      try {
        const data = JSON.parse(rawText);
        if (data.reply) {
          reply = data.reply;
        } else if (res.status >= 500) {
          reply = "⚠️ Assistant unavailable. Please try again later.";
        } else {
          reply = `⚠️ ${data.error || "Request failed"}`;
        }
      } catch {
        reply =
          res.status >= 500
            ? "⚠️ Assistant unavailable. Please try again later."
            : "⚠️ Unexpected response from assistant.";
      }

      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: "assistant", content: reply, timestamp: new Date() },
      ]);
    } catch (e: any) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: "assistant", content: `⚠️ Network error: ${e?.message || "Failed to reach server."}`, timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // Auto-grow textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  if (!user || user.role !== "super_admin") return null;

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] max-h-[900px] bg-[#f0f2f5] rounded-2xl overflow-hidden shadow-lg border border-gray-200">

      {/* ── WhatsApp-style Header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#008069] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shadow">
            <Bot size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-white leading-tight">Business Assistant</h1>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-emerald-300 animate-pulse" : "bg-amber-300"}`} />
              <p className="text-xs text-white/70">{isOnline ? "Powered by DeepSeek · Online" : "Offline mode · chat saved locally"}</p>
            </div>
          </div>
        </div>

        {messages.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowClearConfirm(true)}
              className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Clear chat"
            >
              <Trash2 size={16} className="text-white/80" />
            </button>
            {showClearConfirm && (
              <div className="absolute right-0 top-10 bg-white rounded-xl shadow-xl border border-gray-100 p-3 z-50 w-48">
                <p className="text-xs text-gray-600 mb-2 font-medium">Clear all messages?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setMessages([]); setInput(""); setShowClearConfirm(false); }}
                    className="flex-1 text-xs bg-red-500 hover:bg-red-600 text-white py-1.5 rounded-lg font-medium transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="flex-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Chat Area ── */}
      <div
        ref={chatAreaRef}
        onScroll={handleScroll}
        className="assistant-chat-area flex-1 overflow-y-auto min-h-0 bg-[#e5ddd5] py-3 space-y-1 dark:bg-[#241d1f]"
      >
        {/* ── Empty State ── */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-5 px-6 py-8">
            <div className="w-20 h-20 rounded-full bg-[#008069] flex items-center justify-center shadow-xl">
              <Sparkles size={32} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-700 mb-1">How can I help you?</h2>
              <p className="text-sm text-gray-500 max-w-xs">
                Ask me anything about your business — sales, payments, inventory, balances, expenses, and more.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg mt-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="text-left text-xs bg-white hover:bg-[#008069] hover:text-white text-gray-600 border border-gray-200 hover:border-[#008069] px-3 py-2.5 rounded-xl transition-all shadow-sm font-medium"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Messages ── */}
        {messages.map((msg, i) =>
          msg.loading
            ? <TypingIndicator key={i} />
            : <MessageBubble key={i} msg={msg} />
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Scroll to bottom button ── */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-[80px] right-6 w-9 h-9 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors z-10"
        >
          <ChevronDown size={18} className="text-gray-600" />
        </button>
      )}

      {/* ── Input Bar ── */}
      <div className="flex items-end gap-2 px-3 py-2.5 bg-[#f0f2f5] flex-shrink-0 border-t border-gray-200">
        <div className="flex-1 flex items-end bg-white rounded-2xl px-4 py-2.5 shadow-sm border border-gray-200 focus-within:border-[#008069]/40 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none text-sm text-gray-800 placeholder-gray-400 bg-transparent outline-none leading-relaxed overflow-y-hidden disabled:opacity-60"
            style={{ minHeight: "22px", maxHeight: "120px" }}
          />
        </div>
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          className="w-11 h-11 rounded-full bg-[#008069] hover:bg-[#006d59] flex items-center justify-center flex-shrink-0 shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
        >
          <Send size={18} className="text-white translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
