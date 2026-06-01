'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LoaderCircle, MessagesSquare, RotateCcw, Trash2, X } from 'lucide-react';
import { api, clearToken, type Conversation, type Source, type User } from '@/lib/api';
import { MarkdownView } from '@/components/markdown-view';
import { Badge, Card, DangerButton, SecondaryButton, ThemeToggle } from '@/components/ui';

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '无';
}

function useAdminGuard() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((me) => {
        if (me.role !== 'admin') {
          window.location.href = '/chat';
          return;
        }
        setUser(me);
      })
      .catch(() => {
        window.location.href = '/login';
      })
      .finally(() => setReady(true));
  }, []);

  return { user, ready };
}

export default function AdminConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const { user, ready } = useAdminGuard();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const conversationId = Number(params.id);

  async function loadConversation() {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      setError('会话 ID 无效');
      setLoading(false);
      return;
    }
    setError('');
    setLoading(true);
    try {
      setConversation(await api.adminConversation(conversationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载会话失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready || !user) return;
    void loadConversation();
  }, [ready, user, conversationId]);

  async function updateVisibility(action: 'hide' | 'restore') {
    if (!conversation) return;
    const confirmText = action === 'hide' ? '确认隐藏此对话？隐藏后普通用户将无法看到该对话。' : '确认恢复此对话？恢复后该对话将重新对普通用户可见。';
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    setError('');
    try {
      const updated = action === 'hide'
        ? await api.adminDeleteConversation(conversation.id)
        : await api.adminRestoreConversation(conversation.id);
      setConversation(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : action === 'hide' ? '隐藏会话失败' : '恢复会话失败');
    } finally {
      setSaving(false);
    }
  }

  if (!ready || !user) return null;

  return (
    <main className="min-h-screen p-4 md:p-6 xl:p-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Card className="p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"><MessagesSquare /></div>
                <div className="min-w-0">
                  <h1 className="break-all text-2xl font-bold">{conversation?.title || '会话详情'}</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400">当前管理员：{user.username}</p>
                </div>
              </div>
              {conversation ? <div className="flex flex-wrap gap-2 text-xs"><Badge tone={conversation.deleted_at ? 'red' : 'green'}>{conversation.deleted_at ? '已隐藏' : '正常'}</Badge><Badge tone="neutral">用户 {conversation.username || `#${conversation.user_id}`}</Badge>{conversation.email ? <Badge tone="neutral">{conversation.email}</Badge> : null}<Badge tone="neutral">消息 {conversation.messages.length}</Badge></div> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <ThemeToggle />
              <SecondaryButton onClick={() => { window.location.href = '/admin'; }}>返回管理后台</SecondaryButton>
              <SecondaryButton onClick={() => void loadConversation()} disabled={loading}>{loading ? <LoaderCircle size={16} className="animate-spin" /> : null}刷新</SecondaryButton>
              {conversation?.deleted_at ? <SecondaryButton onClick={() => void updateVisibility('restore')} disabled={saving}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCcw size={16} />}恢复此对话</SecondaryButton> : null}
              {conversation && !conversation.deleted_at ? <DangerButton onClick={() => void updateVisibility('hide')} disabled={saving}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}隐藏此对话</DangerButton> : null}
              <SecondaryButton onClick={() => { clearToken(); window.location.href = '/login'; }}><X size={16} />退出登录</SecondaryButton>
            </div>
          </div>
          {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{error}</p>}
        </Card>

        {loading && !conversation ? <Card className="p-5 text-sm text-slate-500 dark:text-slate-400">加载中...</Card> : null}

        {conversation ? <Card className="space-y-4 p-5">
          <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
            <p>创建：{formatDate(conversation.created_at)}</p>
            <p>更新：{formatDate(conversation.updated_at)}</p>
            <p>隐藏/删除：{formatDate(conversation.deleted_at)}</p>
            <p>会话 ID：#{conversation.id}</p>
          </div>
          <div className="space-y-3">
            {conversation.messages.length ? conversation.messages.map((message) => (
              <div key={message.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone={message.role === 'user' ? 'blue' : message.blocked ? 'red' : 'green'}>{message.role === 'user' ? '用户' : message.blocked ? '助手（拦截）' : '助手'}</Badge>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(message.created_at)}</span>
                </div>
                <MarkdownView content={message.content} />
                {message.sources.length ? <div className="mt-4 space-y-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">来源</p>
                  {(message.sources as Source[]).map((source, index) => (
                    <div key={`${message.id}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                      <p className="font-semibold text-sky-700 dark:text-sky-200">{source.document_name} · {source.location}</p>
                      <MarkdownView content={source.preview} className="mt-1 line-clamp-3 text-xs text-slate-600 dark:text-slate-300" inline />
                    </div>
                  ))}
                </div> : null}
              </div>
            )) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">该会话暂无消息。</p>}
          </div>
        </Card> : null}
      </div>
    </main>
  );
}
