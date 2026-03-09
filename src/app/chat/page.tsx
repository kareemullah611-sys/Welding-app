"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { MessageCircle, Send, Users, User, ArrowLeft, Paperclip, Mic, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Thread {
  id: number;
  type: "direct" | "group";
  name: string | null;
  city: { id: number; name: string } | null;
  lastMessage: { content: string; senderName: string; createdAt: string } | null;
  unreadCount: number;
}

interface Message {
  id: number;
  content: string;
  messageType: "text" | "image" | "file" | "voice";
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  isRead: boolean;
  createdAt: string;
  sender: { id: number; fullName: string; role: string };
  isMine: boolean;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showConversation, setShowConversation] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const activeThreadRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load threads
  const loadThreads = useCallback(async () => {
    const res = await apiCall<{ threads: Thread[] }>("/api/v1/chat/threads");
    if (res.success && res.data) {
      setThreads(res.data.threads);
      setActiveThreadId((prev) => prev ?? res.data!.threads[0]?.id ?? null);
    }
    setLoadingThreads(false);
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Load messages for active thread
  const loadMessages = useCallback(async (threadId: number, markRead = true) => {
    if (markRead) setLoadingMessages(true);
    const res = await apiCall<{ messages: Message[] }>(`/api/v1/chat/threads/${threadId}/messages`);
    if (res.success && res.data) {
      const incoming = res.data.messages.slice().reverse();
      setMessages((prev) => {
        if (prev.length === incoming.length && prev.length > 0 && prev[prev.length - 1].id === incoming[incoming.length - 1].id) {
          return prev;
        }
        return incoming;
      });
      if (markRead) {
        apiCall(`/api/v1/chat/threads/${threadId}/read`, { method: "PUT" }).then(() => {
          loadThreads();
        });
      }
    }
    if (markRead) setLoadingMessages(false);
  }, [loadThreads]);

  // Keep ref in sync so SSE callback reads latest activeThreadId
  useEffect(() => { activeThreadRef.current = activeThreadId; }, [activeThreadId]);

  // Load messages when switching threads
  useEffect(() => {
    if (!activeThreadId) return;
    loadMessages(activeThreadId);
  }, [activeThreadId, loadMessages]);

  // SSE connection for real-time messages
  useEffect(() => {
    const es = new EventSource("/api/v1/chat/stream");
    sseRef.current = es;

    es.onmessage = (event) => {
      try {
        const { threadId, message } = JSON.parse(event.data);
        if (activeThreadRef.current === threadId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
          apiCall(`/api/v1/chat/threads/${threadId}/read`, { method: "PUT" });
        }
        loadThreads();
      } catch {}
    };

    es.onerror = () => {};

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [loadThreads]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !activeThreadId || sending) return;
    setSending(true);
    const content = input.trim();
    setInput("");
    const res = await apiCall<Message>(`/api/v1/chat/threads/${activeThreadId}/messages`, {
      method: "POST",
      body: { content },
    });
    if (res.success && res.data) {
      setMessages((prev) => [...prev, res.data!]);
      loadThreads();
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // File/image upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeThreadId) return;
    e.target.value = "";

    setUploadingFile(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/v1/chat/threads/${activeThreadId}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.data) {
        setMessages((prev) => [...prev, data.data]);
        loadThreads();
      }
    } catch (err) {
      console.error("File upload error:", err);
    }
    setUploadingFile(false);
  };

  // Voice recording
  const startRecording = async () => {
    if (!activeThreadId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 1000) return; // too short, ignore

        setUploadingFile(true);
        const formData = new FormData();
        formData.append("file", blob, `voice-${Date.now()}.${mimeType === "audio/webm" ? "webm" : "ogg"}`);

        try {
          const res = await fetch(`/api/v1/chat/threads/${activeThreadId}/upload`, {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.success && data.data) {
            setMessages((prev) => [...prev, data.data]);
            loadThreads();
          }
        } catch (err) {
          console.error("Voice upload error:", err);
        }
        setUploadingFile(false);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setRecording(false);
    }
  };

  const activeThread = threads.find((t) => t.id === activeThreadId);

  const selectThread = (threadId: number) => {
    setActiveThreadId(threadId);
    setShowConversation(true);
  };

  // Render message content based on type
  const renderMessageContent = (msg: Message) => {
    if (msg.messageType === "image" && msg.fileUrl) {
      return (
        <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={msg.fileUrl}
            alt={msg.fileName || "image"}
            className="max-w-[240px] max-h-[200px] rounded-xl object-cover"
          />
        </a>
      );
    }
    if (msg.messageType === "file" && msg.fileUrl) {
      return (
        <a
          href={msg.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-xl text-sm",
            msg.isMine ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"
          )}
        >
          <FileText size={16} className="flex-shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-medium max-w-[180px]">{msg.fileName || "document.pdf"}</p>
            {msg.fileSize && <p className="text-[10px] opacity-70">{formatFileSize(msg.fileSize)}</p>}
          </div>
        </a>
      );
    }
    if (msg.messageType === "voice" && msg.fileUrl) {
      return (
        <audio
          controls
          src={msg.fileUrl}
          className="max-w-[240px] h-10"
          style={{ minWidth: "180px" }}
        />
      );
    }
    // text
    return (
      <div className={cn(
        "px-3 py-2 rounded-2xl text-sm leading-relaxed",
        msg.isMine ? "bg-blue-500 text-white rounded-br-sm" : "bg-gray-100 text-gray-800 rounded-bl-sm"
      )}>
        {msg.content}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-4 sm:px-6 pt-4 pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 pb-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500 flex-shrink-0"
              >
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Chat</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 ml-11">Communicate with your team</p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden mx-4 sm:mx-6 mb-4 gap-4">
        {/* Left Panel: Thread List */}
        <div className={cn(
          "w-full sm:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden",
          showConversation ? "hidden sm:flex" : "flex"
        )}>
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Conversations</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingThreads ? (
              <div className="p-4 text-sm text-gray-400">Loading...</div>
            ) : threads.length === 0 ? (
              <div className="p-4 text-sm text-gray-400">No conversations yet</div>
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => selectThread(thread.id)}
                  className={cn(
                    "w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-50 hover:bg-gray-50 transition-colors",
                    activeThreadId === thread.id && "bg-blue-50 border-l-2 border-l-blue-500"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                    thread.type === "group" ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"
                  )}>
                    {thread.type === "group" ? <Users size={14} /> : <User size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {thread.type === "group" ? thread.name : (thread.name || thread.city?.name || "Direct")}
                      </span>
                      {thread.unreadCount > 0 && (
                        <span className="flex-shrink-0 bg-blue-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                          {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
                        </span>
                      )}
                    </div>
                    {thread.lastMessage && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {thread.lastMessage.content || "📎 Attachment"}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel: Conversation */}
        <div className={cn(
          "flex-1 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden",
          showConversation ? "flex" : "hidden sm:flex"
        )}>
          {activeThread ? (
            <>
              {/* Thread Header */}
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
                <button
                  onClick={() => setShowConversation(false)}
                  className="sm:hidden w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center",
                  activeThread.type === "group" ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"
                )}>
                  {activeThread.type === "group" ? <Users size={14} /> : <User size={14} />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    {activeThread.type === "group" ? activeThread.name : (activeThread.name || activeThread.city?.name || "Direct Message")}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {activeThread.type === "group" ? "All admins & superadmin" : "Direct message"}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {loadingMessages ? (
                  <div className="text-center text-sm text-gray-400 py-8">Loading messages...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-sm text-gray-400 py-8">
                    <MessageCircle size={32} className="mx-auto mb-2 text-gray-300" />
                    No messages yet. Say hello!
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={cn("flex", msg.isMine ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[70%]", msg.isMine ? "items-end" : "items-start", "flex flex-col gap-0.5")}>
                        {!msg.isMine && (
                          <span className="text-xs text-gray-400 px-1">
                            {msg.sender.fullName}
                            {msg.sender.role === "super_admin" && (
                              <span className="ml-1 text-[10px] bg-purple-100 text-purple-600 px-1 rounded">Admin</span>
                            )}
                          </span>
                        )}
                        {renderMessageContent(msg)}
                        <span className="text-[10px] text-gray-400 px-1">{formatTime(msg.createdAt)}</span>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t border-gray-100">
                {/* Recording indicator */}
                {recording && (
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm text-red-500 font-medium">Recording… release to send</span>
                  </div>
                )}
                {uploadingFile && (
                  <div className="mb-2 px-1 text-sm text-gray-400">Uploading…</div>
                )}
                <div className="flex gap-2 items-end">
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {/* Paperclip button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending || uploadingFile || recording}
                    className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0 text-gray-500"
                    title="Attach image or PDF"
                  >
                    <Paperclip size={16} />
                  </button>

                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message… (Enter to send)"
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-32"
                    style={{ minHeight: "40px" }}
                    disabled={sending || recording}
                  />

                  {/* Mic button — hold to record */}
                  <button
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={stopRecording}
                    onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
                    onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
                    disabled={sending || uploadingFile}
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed",
                      recording
                        ? "bg-red-500 text-white"
                        : "border border-gray-200 text-gray-500 hover:bg-gray-50"
                    )}
                    title="Hold to record voice message"
                  >
                    <Mic size={16} />
                  </button>

                  {/* Send button */}
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || sending || recording}
                    className="w-10 h-10 rounded-xl bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MessageCircle size={48} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm">Select a conversation to start chatting</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
