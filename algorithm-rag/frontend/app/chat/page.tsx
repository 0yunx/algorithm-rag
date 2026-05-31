'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BrainCircuit, Send, Upload, X } from 'lucide-react';
import { api, clearToken, DocumentItem, Source, User } from '@/lib/api';
import { kindLabel, statusLabel, statusTone } from '@/lib/labels';
import { Badge, Button, Card, SecondaryButton, Textarea, ThemeToggle } from '@/components/ui';

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

type SelectedSource = Source & { sourceNumber: number };

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a: ({ children }) => <span className="font-medium text-sky-700 dark:text-sky-200">{children}</span>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatPage() {
  const user = useAuthGuard();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: '你好，我是算法 RAG 助手。请上传或等待管理员审核算法资料后提问。' }]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SelectedSource | null>(null);

  async function loadDocuments() {
    try {
      setDocuments(await api.documents());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文档失败');
    }
  }

  useEffect(() => {
    loadDocuments();
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
      const response = await api.chat(message);
      setMessages((current) => [...current, { role: 'assistant', content: response.answer, sources: response.sources, blocked: response.blocked }]);
    } catch (err) {
      setMessages((current) => [...current, { role: 'assistant', content: err instanceof Error ? err.message : '请求失败', blocked: true }]);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-7xl gap-4 md:min-h-[calc(100vh-3rem)] lg:h-[calc(100vh-3rem)] lg:grid-cols-[320px_minmax(0,1fr)_320px]">
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
            <SecondaryButton onClick={() => { clearToken(); window.location.href = '/login'; }}>退出登录</SecondaryButton>
          </div>
          <input ref={fileInputRef} className="hidden" type="file" accept=".pdf,.md" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
          <Button className="mb-4 w-full" onClick={() => fileInputRef.current?.click()}><Upload size={16} />提交 PDF / MD</Button>
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">普通用户上传后需要管理员审核。</p>
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
            {messages.map((message, index) => (
              <div key={index} className={message.role === 'user' ? 'ml-auto max-w-3xl' : 'mr-auto max-w-4xl'}>
                <div className={message.role === 'user' ? 'rounded-2xl bg-sky-600 p-4 text-white shadow-sm' : 'rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'}>
                  <MarkdownMessage content={message.content} />
                </div>
                {message.sources?.length ? (
                  <div className="mt-2 grid gap-2">
                    {message.sources.map((source, sourceIndex) => (
                      <button
                        key={`${source.document_id}-${source.location}-${sourceIndex}`}
                        type="button"
                        onClick={() => setSelectedSource({ ...source, sourceNumber: sourceIndex + 1 })}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 shadow-sm transition hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:bg-sky-950/40"
                      >
                        <div className="font-semibold text-sky-700 dark:text-sky-200">来源 {sourceIndex + 1} · {source.document_name} · {source.location}</div>
                        <div className="mt-1 line-clamp-2">{source.preview}</div>
                      </button>
                    ))}
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

        <Card className="flex min-h-[18rem] flex-col overflow-hidden lg:min-h-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-bold">来源详情</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">点击回答下方来源查看片段</p>
            </div>
            {selectedSource && (
              <button
                type="button"
                onClick={() => setSelectedSource(null)}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="关闭来源详情"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedSource ? (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">文档</p>
                  <p className="mt-1 break-words font-semibold text-slate-900 dark:text-slate-100">{selectedSource.document_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">位置</p>
                  <p className="mt-1 break-words text-slate-700 dark:text-slate-200">来源 {selectedSource.sourceNumber} · {selectedSource.location}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">匹配片段</p>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-200">{selectedSource.preview || '暂无片段'}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                选择任一回答来源后，会在此处显示文档名称、位置和匹配片段。
              </div>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
