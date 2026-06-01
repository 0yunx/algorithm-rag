'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Eye, LoaderCircle, Send, Upload, X } from 'lucide-react';
import { api, clearToken, DocumentDetail, DocumentItem, Source, User, type ConversationSummary } from '@/lib/api';
import { kindLabel, statusLabel, statusTone } from '@/lib/labels';
import { MarkdownView } from '@/components/markdown-view';
import { Badge, Button, Card, DangerButton, SecondaryButton, Textarea, ThemeToggle } from '@/components/ui';

function useAuthGuard() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    api.me()
      .then((me) => {
        if (me.role === 'admin') window.location.href = '/admin';
        else setUser(me);
      })
      .catch(() => (window.location.href = '/login'));
  }, []);
  return user;
}

type Message = { role: 'user' | 'assistant'; content: string; sources?: Source[]; blocked?: boolean };

export default function ChatPage() {
  const user = useAuthGuard();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [documentDetail, setDocumentDetail] = useState<DocumentDetail | null>(null);
  const [loadingDocumentId, setLoadingDocumentId] = useState<number | null>(null);

  async function loadDocuments() {
    try {
      setDocuments(await api.documents());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文档失败');
    }
  }

  async function loadConversations() {
    try {
      setConversations(await api.conversations());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载对话失败');
    }
  }

  useEffect(() => {
    loadDocuments();
    loadConversations();
    const interval = window.setInterval(loadDocuments, 3000);
    return () => window.clearInterval(interval);
  }, []);

  const readyCount = useMemo(() => documents.filter((doc) => doc.status === 'ready').length, [documents]);

  async function upload(file: File) {
    setError('');
    try {
      await api.upload(file);
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    }
  }

  async function send() {
    const message = input.trim();
    if (!message || loading) return;
    setMessages((current) => [...current, { role: 'user', content: message }]);
    setInput('');
    setLoading(true);
    try {
      const response = await api.chat(message, activeConversationId);
      setActiveConversationId(response.conversation_id);
      setMessages((current) => [...current, { role: 'assistant', content: response.answer, sources: response.sources, blocked: response.blocked }]);
      await loadConversations();
    } catch (err) {
      setMessages((current) => [...current, { role: 'assistant', content: err instanceof Error ? err.message : '请求失败', blocked: true }]);
    } finally {
      setLoading(false);
    }
  }

  async function openConversation(conversationId: number) {
    setError('');
    setLoading(true);
    try {
      const conversation = await api.conversation(conversationId);
      setActiveConversationId(conversation.id);
      setMessages(conversation.messages.map((message) => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
        sources: message.sources as Source[],
        blocked: message.blocked,
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载对话失败');
    } finally {
      setLoading(false);
    }
  }

  function startNewConversation() {
    setActiveConversationId(null);
    setMessages([]);
  }

  async function viewDocument(documentId: number) {
    setError('');
    setLoadingDocumentId(documentId);
    try {
      setDocumentDetail(await api.document(documentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取文档失败');
    } finally {
      setLoadingDocumentId(null);
    }
  }

  if (!user) return null;

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid h-[calc(100vh-2rem)] max-w-7xl gap-4 md:h-[calc(100vh-3rem)] lg:grid-cols-[320px_1fr]">
        <Card className="flex min-h-0 flex-col p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"><BrainCircuit size={20} /></div>
              <div>
                <h1 className="text-lg font-bold">算法知识库</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">{readyCount} 个文档可查询</p>
              </div>
            </div>
          </div>
          <div className="mb-4 grid gap-2">
            <ThemeToggle />
            <SecondaryButton onClick={startNewConversation}>新对话</SecondaryButton>
            <SecondaryButton onClick={() => { clearToken(); window.location.href = '/login'; }}>退出登录</SecondaryButton>
          </div>
          <input ref={fileInputRef} className="hidden" type="file" accept=".pdf,.md" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
          <Button className="mb-4 w-full" onClick={() => fileInputRef.current?.click()}><Upload size={16} />提交 PDF / MD</Button>
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">普通用户上传后需要管理员审核。</p>
          <div className="mb-4 max-h-48 space-y-2 overflow-y-auto pr-1">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">历史对话</p>
            {conversations.length ? conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={conversation.id === activeConversationId ? 'w-full rounded-xl border border-sky-300 bg-sky-50 p-3 text-left text-xs text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100' : 'w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300'}
                onClick={() => void openConversation(conversation.id)}
              >
                <span className="block truncate font-medium">{conversation.title}</span>
                {conversation.last_message_preview && <span className="mt-1 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">{conversation.last_message_preview}</span>}
                <span className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">{new Date(conversation.updated_at).toLocaleString('zh-CN', { hour12: false })}</span>
              </button>
            )) : <p className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">暂无历史对话。</p>}
          </div>
          {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{error}</p>}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {documents.map((doc) => (
              <div key={doc.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="break-all text-sm font-medium">{doc.filename}</p>
                  <Badge tone={statusTone(doc.status)}>{statusLabel(doc.status)}</Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{kindLabel(doc.kind)}</p>
                {doc.error_message && <p className="mt-2 text-xs text-red-600 dark:text-red-200">{doc.error_message}</p>}
                <SecondaryButton className="mt-3 w-full text-xs" onClick={() => void viewDocument(doc.id)} disabled={loadingDocumentId === doc.id}>
                  {loadingDocumentId === doc.id ? <LoaderCircle size={14} className="animate-spin" /> : <Eye size={14} />}
                  查看文档
                </SecondaryButton>
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-slate-200 p-4 dark:border-slate-800">
            <h2 className="text-xl font-bold">算法 RAG 聊天</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">只回答算法、数据结构、复杂度和刷题方法相关问题。当前用户：{user.username}</p>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/60 p-4 dark:bg-slate-950/40">
            {!activeConversationId && !messages.length ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-slate-400 dark:text-slate-500">选择左侧历史对话，或输入问题开始新对话</p>
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div key={index} className={message.role === 'user' ? 'ml-auto max-w-3xl' : 'mr-auto max-w-4xl'}>
                <div className={message.role === 'user' ? 'rounded-2xl bg-sky-600 p-4 text-white shadow-sm' : 'rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'}>
                  {message.blocked && <Badge tone="red">已拦截</Badge>}
                  <MarkdownView content={message.content} className={message.role === 'user' ? 'text-white' : undefined} />
                </div>
                {message.sources?.length ? (
                  <div className="mt-2 grid gap-2">
                    {message.sources.map((source, sourceIndex) => {
                      const sourceContent = (
                        <>
                          <div className="font-semibold text-sky-700 dark:text-sky-200">{source.document_name} · {source.location}</div>
                          <MarkdownView content={source.preview} className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300" inline />
                        </>
                      );

                      return source.document_id ? (
                        <button
                          key={sourceIndex}
                          type="button"
                          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 shadow-sm transition hover:border-sky-300 hover:bg-sky-50/60 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-400/40 dark:hover:bg-sky-400/10"
                          onClick={() => void viewDocument(source.document_id)}
                        >
                          {sourceContent}
                        </button>
                      ) : (
                        <div key={sourceIndex} className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                          {sourceContent}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
            {loading && <p className="text-sm text-slate-500 dark:text-slate-400">正在检索并生成回答...</p>}
          </div>
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <div className="flex gap-3">
              <Textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入算法问题，例如：二分查找边界怎么处理？" rows={2} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} />
              <Button className="self-stretch" disabled={loading} onClick={send}><Send size={16} />发送</Button>
            </div>
          </div>
        </Card>
      </div>
      {documentDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <Card className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
              <div className="min-w-0">
                <h2 className="break-all text-lg font-bold">{documentDetail.filename}</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">#{documentDetail.id} · {kindLabel(documentDetail.kind)} · {statusLabel(documentDetail.status)}</p>
              </div>
              <DangerButton className="px-3" onClick={() => setDocumentDetail(null)} aria-label="关闭文档预览" title="关闭文档预览"><X size={16} /></DangerButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5 dark:bg-slate-950/40">
              {documentDetail.content.trim() ? (
                <MarkdownView content={documentDetail.content} />
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">该文档没有可显示的文本内容。</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
