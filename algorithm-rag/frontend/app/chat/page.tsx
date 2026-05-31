'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { BrainCircuit, MessageSquarePlus, Search, Send, Trash2, Upload, X } from 'lucide-react';
import { api, clearToken, type ConversationSearchResult, type ConversationSummary, type DocumentItem, type DocumentVisibility, type Source, type User } from '@/lib/api';
import { kindLabel, statusLabel, statusTone, visibilityLabel, visibilityTone } from '@/lib/labels';
import { Badge, Button, Card, DangerButton, Input, SecondaryButton, Select, Textarea, ThemeToggle } from '@/components/ui';

function useAuthGuard() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api.me()
      .then(setUser)
      .catch(() => (window.location.href = '/login'));
  }, []);

  return user;
}

type Message = { id?: number; role: 'user' | 'assistant'; content: string; sources?: Source[]; blocked?: boolean };
type SelectedSource = { source: Source; messageIndex: number; sourceIndex: number };

const welcomeMessage: Message = { role: 'assistant', content: '你好，我是算法 RAG 助手。请上传或等待管理员审核算法资料后提问。' };

function MarkdownMessage({ content, inverse = false }: { content: string; inverse?: boolean }) {
  return (
    <div className={inverse ? 'chat-markdown chat-markdown-inverse' : 'chat-markdown'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function SourceDetailsPanel({ selected, onClose }: { selected: SelectedSource | null; onClose: () => void }) {
  return (
    <Card className="flex min-h-0 flex-col overflow-hidden p-4 lg:h-full">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-bold">来源详情</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">点击回答下方来源查看匹配片段。</p>
        </div>
        {selected && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="关闭来源详情"
          >
            <X size={18} />
          </button>
        )}
      </div>
      {selected ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">文档名称</p>
            <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{selected.source.document_name}</p>
          </div>
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">位置</p>
            <p className="break-words text-sm text-slate-700 dark:text-slate-200">{selected.source.location}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">匹配片段</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">{selected.source.preview}</p>
          </div>
          {selected.source.score !== null && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">相关度分数：{selected.source.score.toFixed(4)}</p>}
        </div>
      ) : (
        <div className="flex min-h-40 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          暂未选择来源。
        </div>
      )}
    </Card>
  );
}

export default function ChatPage() {
  const user = useAuthGuard();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);
  const [uploadVisibility, setUploadVisibility] = useState<DocumentVisibility>('private');
  const [selectedSource, setSelectedSource] = useState<SelectedSource | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const activeConversation = useMemo(() => conversations.find((item) => item.id === activeConversationId), [activeConversationId, conversations]);
  const readyCount = useMemo(() => documents.filter((doc) => doc.status === 'ready').length, [documents]);
  const visibleCount = useMemo(() => documents.filter((doc) => doc.status === 'ready' && (doc.visibility === 'private' || doc.visibility === 'shared' || doc.visibility === 'system')).length, [documents]);

  const loadDocuments = useCallback(async () => {
    try {
      setDocuments(await api.documents());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文档失败');
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.conversations());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载会话失败');
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadDocuments();
    void loadConversations();
    const interval = window.setInterval(loadDocuments, 3000);
    return () => window.clearInterval(interval);
  }, [loadConversations, loadDocuments, user]);

  async function upload(file: File) {
    setError('');
    try {
      await api.upload(file, uploadVisibility);
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function openConversation(id: number, highlightMessageId?: number) {
    setError('');
    setLoadingConversation(true);
    try {
      const conversation = await api.getConversation(id);
      setActiveConversationId(conversation.id);
      setMessages(conversation.messages.map((message) => ({ id: message.id, role: message.role, content: message.content, sources: message.sources, blocked: message.blocked })));
      setHighlightedMessageId(highlightMessageId ?? null);
      setSelectedSource(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开会话失败');
    } finally {
      setLoadingConversation(false);
    }
  }

  function startNewConversation() {
    setActiveConversationId(null);
    setHighlightedMessageId(null);
    setSelectedSource(null);
    setMessages([welcomeMessage]);
    setInput('');
  }

  async function runSearch() {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    setError('');
    try {
      setSearchResults(await api.searchConversations(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    }
  }

  async function deleteConversation(id: number) {
    if (!window.confirm('确认软删除这个会话？')) return;
    setError('');
    setDeletingId(id);
    try {
      await api.deleteConversation(id);
      if (activeConversationId === id) startNewConversation();
      setSearchResults((current) => current.filter((item) => item.conversation_id !== id));
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除会话失败');
    } finally {
      setDeletingId(null);
    }
  }

  async function send() {
    const message = input.trim();
    if (!message || loading) return;
    const conversationIdAtSend = activeConversationId;
    setMessages((current) => [...current.filter((item) => item !== welcomeMessage || conversationIdAtSend !== null), { role: 'user', content: message }]);
    setHighlightedMessageId(null);
    setInput('');
    setLoading(true);
    try {
      const response = await api.chat(message, conversationIdAtSend);
      const nextConversationId = response.conversation_id ?? conversationIdAtSend;
      if (nextConversationId) {
        await loadConversations();
        await openConversation(nextConversationId);
      } else {
        setMessages((current) => [...current, { role: 'assistant', content: response.answer, sources: response.sources, blocked: response.blocked }]);
      }
    } catch (err) {
      setMessages((current) => [...current, { role: 'assistant', content: err instanceof Error ? err.message : '请求失败', blocked: true }]);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-7xl gap-4 md:min-h-[calc(100vh-3rem)] lg:h-[calc(100vh-3rem)] lg:grid-cols-[300px_minmax(0,1fr)_340px] xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <Card className="flex min-h-0 flex-col p-4 lg:h-full">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"><BrainCircuit size={20} /></div>
              <div>
                <h1 className="text-lg font-bold">算法知识库</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">{conversations.length} 个会话</p>
              </div>
            </div>
          </div>
          <div className="mb-4 grid gap-2">
            <ThemeToggle />
            {user.role === 'admin' && <Button onClick={() => (window.location.href = '/admin')}>管理员控制台</Button>}
            <SecondaryButton onClick={() => { clearToken(); window.location.href = '/login'; }}>退出登录</SecondaryButton>
            <Button onClick={startNewConversation}><MessageSquarePlus size={16} />新会话</Button>
          </div>

          <div className="mb-4 space-y-2">
            <div className="flex gap-2">
              <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }} placeholder="搜索历史问答" />
              <SecondaryButton aria-label="搜索" onClick={() => void runSearch()}><Search size={16} /></SecondaryButton>
            </div>
            {searchResults.length ? (
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                {searchResults.map((result) => (
                  <button key={`${result.conversation_id}-${result.message_id}`} className="block w-full rounded-lg p-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => void openConversation(result.conversation_id, result.message_id)}>
                    <p className="font-semibold text-sky-700 dark:text-sky-200">{result.title}</p>
                    <p className="mt-1 line-clamp-2 text-slate-600 dark:text-slate-300">{result.snippet}</p>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{error}</p>}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">会话列表</p>
            {conversations.length ? conversations.map((conversation) => (
              <div key={conversation.id} className={conversation.id === activeConversationId ? 'rounded-xl border border-sky-300 bg-sky-50 p-3 dark:border-sky-500/40 dark:bg-sky-500/10' : 'rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50'}>
                <button className="block w-full text-left" onClick={() => void openConversation(conversation.id)}>
                  <p className="truncate text-sm font-medium">{conversation.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{conversation.last_message_preview || '暂无消息'}</p>
                </button>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>{new Date(conversation.updated_at).toLocaleString('zh-CN', { hour12: false })}</span>
                  <DangerButton className="px-2 py-1 text-xs" onClick={() => void deleteConversation(conversation.id)} disabled={deletingId === conversation.id}><Trash2 size={12} />删除</DangerButton>
                </div>
              </div>
            )) : <p className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">暂无会话，发送第一条消息后会自动创建。</p>}
          </div>
        </Card>

        <Card className="flex min-h-[70vh] flex-col overflow-hidden lg:h-full lg:min-h-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-xl font-bold">{activeConversation?.title || '算法 RAG 聊天'}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">只回答算法、数据结构、复杂度和刷题方法相关问题。当前用户：{user.username}</p>
            </div>
            <div className="grid min-w-52 gap-2 text-xs">
              <div className="flex flex-wrap gap-2">
                <Badge tone="green">可查询 {readyCount}</Badge>
                <Badge tone="blue">当前可见 {visibleCount}</Badge>
              </div>
              <Select value={uploadVisibility} onChange={(event) => setUploadVisibility(event.target.value as DocumentVisibility)} aria-label="上传文档可见性">
                <option value="private">私有文档</option>
                <option value="shared">共享文档</option>
              </Select>
              <input ref={fileInputRef} className="hidden" type="file" accept=".pdf,.md" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
              <Button className="w-full" onClick={() => fileInputRef.current?.click()}><Upload size={16} />提交 PDF / MD</Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/60 p-4 dark:bg-slate-950/40">
            {loadingConversation ? <p className="text-sm text-slate-500 dark:text-slate-400">正在打开会话...</p> : messages.map((message, index) => {
              const highlighted = message.id !== undefined && message.id === highlightedMessageId;
              return (
                <div key={message.id ?? index} className={message.role === 'user' ? 'ml-auto max-w-3xl' : 'mr-auto max-w-4xl'}>
                  <div className={(message.role === 'user' ? 'rounded-2xl bg-sky-600 p-4 text-white shadow-sm' : 'rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100') + (highlighted ? ' ring-4 ring-amber-300 dark:ring-amber-400/60' : '')}>
                    <MarkdownMessage content={message.content} inverse={message.role === 'user'} />
                  </div>
                  {message.sources?.length ? (
                    <div className="mt-2 grid gap-2">
                      {message.sources.map((source, sourceIndex) => {
                        const isSelected = selectedSource?.messageIndex === index && selectedSource.sourceIndex === sourceIndex;
                        return (
                          <button
                            key={sourceIndex}
                            type="button"
                            onClick={() => setSelectedSource({ source, messageIndex: index, sourceIndex })}
                            className={isSelected ? 'rounded-xl border border-sky-400 bg-sky-50 p-3 text-left text-xs text-slate-700 shadow-sm ring-2 ring-sky-100 transition hover:border-sky-500 dark:border-sky-500 dark:bg-sky-500/10 dark:text-slate-200 dark:ring-sky-500/20' : 'rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 shadow-sm transition hover:border-sky-300 hover:bg-sky-50/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:bg-sky-500/10'}
                            aria-label={`查看来源：${source.document_name} ${source.location}`}
                          >
                            <div className="font-semibold text-sky-700 dark:text-sky-200">{source.document_name} · {source.location}</div>
                            <div className="mt-1 line-clamp-2">{source.preview}</div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {loading && <p className="text-sm text-slate-500 dark:text-slate-400">正在检索并生成回答...</p>}
          </div>
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <div className="flex gap-3">
              <Textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入算法问题，例如：二分查找边界怎么处理？" rows={2} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} />
              <Button className="self-stretch" disabled={loading} onClick={send}><Send size={16} />发送</Button>
            </div>
          </div>
        </Card>

        <SourceDetailsPanel selected={selectedSource} onClose={() => setSelectedSource(null)} />
      </div>
    </main>
  );
}
