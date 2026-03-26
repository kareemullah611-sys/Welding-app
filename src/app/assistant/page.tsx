"use client";
import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { Send, Bot, User, Sparkles, RotateCcw } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

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

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  // Render markdown-like formatting
  const renderContent = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      // Bold: **text**
      const formatted = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      // Bullet
      if (line.startsWith("•") || line.startsWith("-")) {
        return (
          <div key={i} className="flex gap-2 mt-0.5">
            <span className="text-current opacity-50 flex-shrink-0 mt-0.5">•</span>
            <span dangerouslySetInnerHTML={{ __html: formatted.replace(/^[•\-]\s*/, "") }} />
          </div>
        );
      }
      // Empty line
      if (!line.trim()) return <div key={i} className="h-1" />;
      // Heading (starts with #)
      if (line.startsWith("# ")) {
        return <p key={i} className="font-bold text-base mt-2 mb-1" dangerouslySetInnerHTML={{ __html: formatted.slice(2) }} />;
      }
      return <p key={i} className="leading-relaxed" dangerouslySetInnerHTML={{ __html: formatted }} />;
    });
  };

  if (msg.loading) {
    return (
      <div className="flex gap-3 items-start">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Bot size={16} className="text-white" />
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 items-start ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
        isUser
          ? "bg-gradient-to-br from-primary-500 to-primary-700"
          : "bg-gradient-to-br from-indigo-500 to-purple-600"
      }`}>
        {isUser ? <User size={15} className="text-white" /> : <Bot size={15} className="text-white" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm shadow-sm ${
        isUser
          ? "bg-gradient-to-br from-primary-600 to-primary-700 text-white rounded-tr-sm"
          : "bg-white border border-gray-100 text-gray-800 rounded-tl-sm"
      }`}>
        {isUser
          ? <p className="leading-relaxed">{msg.content}</p>
          : <div className="space-y-0.5">{renderContent(msg.content)}</div>
        }
      </div>
    </div>
  );
}

export default function AssistantPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Redirect non-superadmin
  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;

    setInput("");
    const userMsg: Message = { role: "user", content };
    const loadingMsg: Message = { role: "assistant", content: "", loading: true };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setLoading(true);

    try {
      // Build history (exclude last loading message)
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

      // Read raw text first so we never crash on non-JSON responses
      const rawText = await res.text();
      let reply: string;
      try {
        const data = JSON.parse(rawText);
        if (data.reply) {
          reply = data.reply;
        } else if (data.error) {
          reply = `⚠️ Server error (${res.status}): ${data.error}${data.details ? `\n\nDetails: ${JSON.stringify(data.details)}` : ""}`;
        } else {
          reply = `⚠️ Unexpected response (${res.status}): ${rawText.slice(0, 300)}`;
        }
      } catch {
        // Server returned non-JSON (HTML error page etc.)
        reply = `⚠️ Server returned non-JSON (${res.status}):\n${rawText.slice(0, 500)}`;
      }

      setMessages(prev => [
        ...prev.slice(0, -1), // remove loading
        { role: "assistant", content: reply },
      ]);
    } catch (e: any) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: "assistant", content: `⚠️ Network error: ${e?.message || "Failed to reach server."}` },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => { setMessages([]); setInput(""); };

  if (!user || user.role !== "super_admin") return null;

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] lg:h-[calc(100vh-48px)] max-h-[900px]">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-200">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Business Assistant</h1>
            <p className="text-xs text-gray-400">Powered by Gemini · Full database access</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full transition-colors"
          >
            <RotateCcw size={12} />
            Clear chat
          </button>
        )}
      </div>

      {/* ── Chat Area ── */}
      <div className="flex-1 overflow-y-auto rounded-2xl bg-gray-50 border border-gray-100 p-4 space-y-4 min-h-0">

        {/* Welcome / empty state */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-6 py-8">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-200">
              <Sparkles size={28} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800 mb-1">How can I help you today?</h2>
              <p className="text-sm text-gray-400 max-w-xs">Ask me anything about your business — sales, payments, inventory, balances, transfers, and more.</p>
            </div>

            {/* Suggestion chips */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="text-left text-xs bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 px-3 py-2.5 rounded-xl transition-all shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input Bar ── */}
      <div className="mt-3 flex-shrink-0">
        <div className="flex gap-2 items-end bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your business…"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none text-sm text-gray-800 placeholder-gray-400 bg-transparent outline-none leading-relaxed max-h-32 overflow-y-auto disabled:opacity-60"
            style={{ minHeight: "24px" }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-sm hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
        <p className="text-center text-[10px] text-gray-300 mt-2">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
