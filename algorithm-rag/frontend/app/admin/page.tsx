'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  FileUp,
  KeyRound,
  LoaderCircle,
  MessagesSquare,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  Users,
} from 'lucide-react';
import { api, clearToken, type ChatLog, type Conversation, type ConversationSearchResult, type ConversationSummary, type DocumentItem, type Prompt, type RegistrationRequest, type Role, type Source, type User } from '@/lib/api';
import { kindLabel, statusLabel, statusTone } from '@/lib/labels';
import { Badge, Button, Card, DangerButton, Input, PasswordInput, SecondaryButton, Select, Textarea, ThemeToggle } from '@/components/ui';

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '无';
}

function roleLabel(role: Role) {
  return role === 'admin' ? '管理员' : '普通用户';
}

function requestStatusLabel(status: RegistrationRequest['status']) {
  const labels = { pending: '待审批', approved: '已通过', rejected: '已拒绝' };
  return labels[status];
}

function requestStatusTone(status: RegistrationRequest['status']) {
  if (status === 'approved') return 'green';
  if (status === 'rejected') return 'red';
  return 'yellow';
}

function userDisplay(user?: User) {
  if (!user) return '未知用户';
  const suffix = !user.is_active || user.deleted_at ? '（已删除/停用）' : '';
  return `${user.username}${suffix}`;
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

export default function AdminPage() {
  const { user, ready } = useAdminGuard();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [logs, setLogs] = useState<ChatLog[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [conversationResults, setConversationResults] = useState<ConversationSearchResult[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptDraft, setPromptDraft] = useState('');

  const [loadingCore, setLoadingCore] = useState(true);
  const [loadingPrompt, setLoadingPrompt] = useState(true);
  const [refreshingCore, setRefreshingCore] = useState(false);

  const [pageError, setPageError] = useState('');
  const [promptError, setPromptError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [userFormError, setUserFormError] = useState('');

  const [uploading, setUploading] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [userActionId, setUserActionId] = useState<number | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', role: 'people' as Role });

  const usersById = useMemo(() => Object.fromEntries(users.map((item) => [item.id, userDisplay(item)])), [users]);
  const pendingDocuments = useMemo(() => documents.filter((item) => item.status === 'pending_approval'), [documents]);
  const readyCount = useMemo(() => documents.filter((item) => item.status === 'ready').length, [documents]);
  const pendingCount = useMemo(() => documents.filter((item) => item.status === 'pending_approval').length, [documents]);
  const failedCount = useMemo(() => documents.filter((item) => item.status === 'failed').length, [documents]);
  const pendingRequests = useMemo(() => requests.filter((item) => item.status === 'pending'), [requests]);
  const recentLogs = useMemo(() => logs.slice(0, 12), [logs]);

  const loadCore = useCallback(async (silent = false) => {
    if (silent) setRefreshingCore(true);
    else setLoadingCore(true);
    setPageError('');
    try {
      const [docs, userList, registrationRequests, chatLogs, conversationList] = await Promise.all([api.documents(), api.users(), api.registrationRequests(), api.chatLogs(), api.adminConversations()]);
      setDocuments(docs);
      setUsers(userList);
      setRequests(registrationRequests);
      setLogs(chatLogs);
      setConversations(conversationList);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '加载管理数据失败');
    } finally {
      if (silent) setRefreshingCore(false);
      else setLoadingCore(false);
    }
  }, []);

  const loadPrompt = useCallback(async () => {
    setLoadingPrompt(true);
    setPromptError('');
    try {
      const activePrompt = await api.getPrompt();
      setPrompt(activePrompt);
      setPromptDraft(activePrompt.content);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : '加载系统提示词失败');
    } finally {
      setLoadingPrompt(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadCore(true), loadPrompt()]);
  }, [loadCore, loadPrompt]);

  useEffect(() => {
    if (!ready || !user) return;
    void loadCore();
    void loadPrompt();
    const timer = window.setInterval(() => {
      void loadCore(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadCore, loadPrompt, ready, user]);

  useEffect(() => {
    const query = conversationSearch.trim();
    if (!query) {
      setConversationResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.adminSearchConversations(query).then(setConversationResults).catch((error) => setPageError(error instanceof Error ? error.message : '搜索对话失败'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [conversationSearch]);

  async function openConversation(id: number) {
    setPageError('');
    try {
      setSelectedConversation(await api.adminGetConversation(id));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '打开对话失败');
    }
  }

  async function deleteConversation(id: number) {
    if (!window.confirm('确认软删除该对话？')) return;
    setPageError('');
    try {
      await api.adminDeleteConversation(id);
      if (selectedConversation?.id === id) setSelectedConversation(null);
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除对话失败');
    }
  }

  async function handleUpload(file: File) {
    setUploadError('');
    setUploading(true);
    try {
      await api.upload(file);
      await loadCore(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function approveDocument(id: number) {
    setPageError('');
    setApprovingId(id);
    try {
      await api.approve(id);
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '审核失败');
    } finally {
      setApprovingId(null);
    }
  }

  async function retryDocument(id: number) {
    setPageError('');
    setRetryingId(id);
    try {
      await api.retry(id);
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '重试失败');
    } finally {
      setRetryingId(null);
    }
  }

  async function reviewRegistration(id: number, action: 'approve' | 'reject') {
    setPageError('');
    setReviewingId(id);
    try {
      if (action === 'approve') await api.approveRegistration(id);
      else await api.rejectRegistration(id);
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '处理注册申请失败');
    } finally {
      setReviewingId(null);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserFormError('');
    if (!newUser.username.trim() || !newUser.password.trim()) {
      setUserFormError('用户名和密码不能为空');
      return;
    }
    if (newUser.email.trim() && !newUser.email.includes('@')) {
      setUserFormError('请输入有效邮箱');
      return;
    }
    setCreatingUser(true);
    try {
      await api.createUser({ username: newUser.username.trim(), email: newUser.email.trim() || undefined, password: newUser.password, role: newUser.role });
      setNewUser({ username: '', email: '', password: '', role: 'people' });
      await loadCore(true);
    } catch (error) {
      setUserFormError(error instanceof Error ? error.message : '创建用户失败');
    } finally {
      setCreatingUser(false);
    }
  }

  async function resetPassword(item: User) {
    const nextPassword = window.prompt(`为 ${item.username} 设置新密码（至少 6 位）`);
    if (!nextPassword) return;
    if (nextPassword.length < 6) {
      setPageError('新密码至少 6 位');
      return;
    }
    setPageError('');
    setUserActionId(item.id);
    try {
      await api.resetPassword(item.id, nextPassword);
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '重置密码失败');
    } finally {
      setUserActionId(null);
    }
  }

  async function deleteUser(item: User) {
    if (!window.confirm(`确认软删除用户 ${item.username}？历史文档和聊天记录会保留。`)) return;
    setPageError('');
    setUserActionId(item.id);
    try {
      await api.deleteUser(item.id);
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除用户失败');
    } finally {
      setUserActionId(null);
    }
  }

  async function savePrompt() {
    setPromptError('');
    if (!promptDraft.trim()) {
      setPromptError('系统提示词内容不能为空');
      return;
    }
    setSavingPrompt(true);
    try {
      const updated = await api.updatePrompt(promptDraft);
      setPrompt(updated);
      setPromptDraft(updated.content);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : '保存系统提示词失败');
    } finally {
      setSavingPrompt(false);
    }
  }

  if (!ready || !user) return null;

  return (
    <main className="min-h-screen p-4 md:p-6 xl:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <Card className="p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"><ShieldCheck /></div>
                <div>
                  <h1 className="text-2xl font-bold">算法 RAG 管理后台</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400">当前登录：{user.username} · {roleLabel(user.role)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone="blue">可查询 {readyCount}</Badge>
                <Badge tone="yellow">待审核文档 {pendingCount}</Badge>
                <Badge tone="yellow">待审批注册 {pendingRequests.length}</Badge>
                <Badge tone="red">失败 {failedCount}</Badge>
                <Badge tone="neutral">用户 {users.length}</Badge>
                <Badge tone="neutral">聊天日志 {logs.length}</Badge>
                <Badge tone="neutral">对话 {conversations.length}</Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ThemeToggle />
              <SecondaryButton onClick={() => void refreshAll()} disabled={refreshingCore || loadingPrompt}>
                <RefreshCw size={16} className={refreshingCore ? 'animate-spin' : ''} />刷新
              </SecondaryButton>
              <SecondaryButton onClick={() => { clearToken(); window.location.href = '/login'; }}>退出登录</SecondaryButton>
            </div>
          </div>
          {pageError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{pageError}</p>}
        </Card>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-2"><FileUp size={18} className="text-sky-600 dark:text-sky-200" /><div><h2 className="text-lg font-semibold">直接上传</h2><p className="text-xs text-slate-500 dark:text-slate-400">管理员上传后会直接进入索引流程，不需要审核。</p></div></div>
            <input ref={fileInputRef} className="hidden" type="file" accept=".pdf,.md" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) await handleUpload(file); }} />
            <Button className="w-full" onClick={() => fileInputRef.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle size={16} className="animate-spin" /> : <Upload size={16} />}{uploading ? '上传中...' : '选择 PDF / MD'}</Button>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">上传上限由后端配置控制，超限会直接报错。</p>
            {uploadError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{uploadError}</p>}
          </Card>

          <Card className="space-y-4 p-5 xl:col-span-2">
            <div className="flex items-center gap-2"><UserCheck size={18} className="text-emerald-600 dark:text-emerald-200" /><div><h2 className="text-lg font-semibold">注册申请审批</h2><p className="text-xs text-slate-500 dark:text-slate-400">通过后会创建普通用户；拒绝后申请人可重新提交。</p></div></div>
            <div className="grid max-h-[26rem] gap-3 overflow-y-auto pr-1 lg:grid-cols-2">
              {loadingCore && !requests.length ? <p className="text-sm text-slate-500 dark:text-slate-400">加载中...</p> : requests.length ? requests.map((request) => (
                <div key={request.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{request.username}</p><p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">{request.email}</p></div><Badge tone={requestStatusTone(request.status)}>{requestStatusLabel(request.status)}</Badge></div>
                  {request.reason && <p className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{request.reason}</p>}
                  <div className="mt-3 grid gap-1 text-xs text-slate-500 dark:text-slate-400"><p>提交：{formatDate(request.created_at)}</p><p>审核：{formatDate(request.reviewed_at)}{request.reviewed_by ? ` · ${usersById[request.reviewed_by] || `#${request.reviewed_by}`}` : ''}</p></div>
                  {request.status === 'pending' && <div className="mt-3 flex gap-2"><Button className="text-xs" onClick={() => void reviewRegistration(request.id, 'approve')} disabled={reviewingId === request.id}>{reviewingId === request.id ? <LoaderCircle size={14} className="animate-spin" /> : null}通过</Button><DangerButton className="text-xs" onClick={() => void reviewRegistration(request.id, 'reject')} disabled={reviewingId === request.id}>拒绝</DangerButton></div>}
                </div>
              )) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">暂无注册申请。</p>}
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-2"><AlertTriangle size={18} className="text-amber-600 dark:text-amber-200" /><div><h2 className="text-lg font-semibold">待审核文档</h2><p className="text-xs text-slate-500 dark:text-slate-400">普通用户上传后会出现在这里。</p></div></div>
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
              {loadingCore && !documents.length ? <p className="text-sm text-slate-500 dark:text-slate-400">加载中...</p> : pendingDocuments.length ? pendingDocuments.map((document) => (
                <div key={document.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{document.filename}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{kindLabel(document.kind)} · 上传者 {usersById[document.uploaded_by] || `#${document.uploaded_by}`}</p></div><Badge tone={statusTone(document.status)}>{statusLabel(document.status)}</Badge></div>
                  <div className="mt-3 flex gap-2"><Button className="text-xs" onClick={() => void approveDocument(document.id)} disabled={approvingId === document.id}>{approvingId === document.id ? <LoaderCircle size={14} className="animate-spin" /> : null}审核通过</Button></div>
                </div>
              )) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">当前没有待审核文档。</p>}
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-2"><RefreshCw size={18} className="text-sky-600 dark:text-sky-200" /><div><h2 className="text-lg font-semibold">文档状态 / 重试</h2><p className="text-xs text-slate-500 dark:text-slate-400">查看最近文档的索引状态。</p></div></div>
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
              {documents.length ? documents.map((document) => {
                const canRetry = document.status === 'failed' || document.status === 'processing';
                return <div key={document.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{document.filename}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">#{document.id} · {kindLabel(document.kind)} · 上传者 {usersById[document.uploaded_by] || `#${document.uploaded_by}`}</p></div><Badge tone={statusTone(document.status)}>{statusLabel(document.status)}</Badge></div>
                  <div className="mt-3 grid gap-1 text-xs text-slate-500 dark:text-slate-400"><p>创建：{formatDate(document.created_at)}</p><p>更新：{formatDate(document.updated_at)}</p><p>审核者：{document.approved_by ? usersById[document.approved_by] || `#${document.approved_by}` : '无'}</p>{document.error_message && <p className="rounded-xl border border-red-200 bg-red-50 p-2 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">错误：{document.error_message}</p>}</div>
                  {canRetry && <div className="mt-3 flex gap-2"><SecondaryButton className="text-xs" onClick={() => void retryDocument(document.id)} disabled={retryingId === document.id}>{retryingId === document.id ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}重试索引</SecondaryButton></div>}
                </div>;
              }) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">暂无文档。</p>}
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-2"><Users size={18} className="text-emerald-600 dark:text-emerald-200" /><div><h2 className="text-lg font-semibold">用户管理</h2><p className="text-xs text-slate-500 dark:text-slate-400">创建用户、重置密码、软删除账号。</p></div></div>
            <form className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40" onSubmit={createUser}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><label className="block space-y-2 text-sm"><span>用户名</span><Input value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} placeholder="请输入用户名" /></label><label className="block space-y-2 text-sm"><span>邮箱（可选）</span><Input type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} placeholder="请输入邮箱" /></label></div>
              <label className="block space-y-2 text-sm"><span>密码</span><PasswordInput value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} placeholder="至少 6 位" autoComplete="new-password" /></label>
              <label className="block space-y-2 text-sm"><span>角色</span><Select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as Role }))}><option value="people">普通用户</option><option value="admin">管理员</option></Select></label>
              {userFormError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{userFormError}</p>}
              <Button className="w-full" disabled={creatingUser}>{creatingUser ? <LoaderCircle size={16} className="animate-spin" /> : null}创建用户</Button>
            </form>
            <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
              {users.length ? users.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">{item.username}</p><p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">#{item.id} · {item.email || '无邮箱'}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">创建：{formatDate(item.created_at)}{item.deleted_at ? ` · 删除：${formatDate(item.deleted_at)}` : ''}</p></div><Badge tone={item.role === 'admin' ? 'blue' : 'neutral'}>{roleLabel(item.role)}</Badge></div><div className="mt-2 flex flex-wrap gap-2"><Badge tone={item.is_active ? 'green' : 'red'}>{item.is_active ? '启用' : '停用/已删除'}</Badge>{item.is_builtin && <Badge tone="blue">内置</Badge>}</div><div className="mt-3 flex flex-wrap gap-2"><SecondaryButton className="text-xs" onClick={() => void resetPassword(item)} disabled={!item.is_active || !!item.deleted_at || userActionId === item.id}><KeyRound size={14} />重置密码</SecondaryButton><DangerButton className="text-xs" onClick={() => void deleteUser(item)} disabled={!item.is_active || !!item.deleted_at || item.is_builtin || item.id === user.id || userActionId === item.id}><Trash2 size={14} />软删除</DangerButton></div></div>) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">暂无用户。</p>}
            </div>
          </Card>

          <Card className="space-y-4 p-5 xl:col-span-2">
            <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-sky-600 dark:text-sky-200" /><div><h2 className="text-lg font-semibold">系统提示词编辑</h2><p className="text-xs text-slate-500 dark:text-slate-400">修改当前生效的系统提示词，保存后立即切换。</p></div></div>
            {loadingPrompt && !prompt ? <p className="text-sm text-slate-500 dark:text-slate-400">加载中...</p> : <><div className="flex flex-wrap gap-2 text-xs"><Badge tone="blue">{prompt?.name || '当前生效'}</Badge>{prompt ? <Badge tone="neutral">更新于 {formatDate(prompt.updated_at)}</Badge> : null}</div><Textarea rows={14} value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} placeholder="编辑系统提示词" />{promptError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{promptError}</p>}<div className="flex justify-end"><Button onClick={() => void savePrompt()} disabled={savingPrompt}>{savingPrompt ? <LoaderCircle size={16} className="animate-spin" /> : null}保存提示词</Button></div></>}
          </Card>

          <Card className="space-y-4 p-5 xl:col-span-3">
            <div className="flex items-center gap-2"><MessagesSquare size={18} className="text-sky-600 dark:text-sky-200" /><div><h2 className="text-lg font-semibold">对话管理</h2><p className="text-xs text-slate-500 dark:text-slate-400">搜索、查看并软删除所有用户未删除的对话。</p></div></div>
            <Input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索所有对话内容" />
            {conversationResults.length ? <div className="grid gap-2 lg:grid-cols-2">{conversationResults.map((result) => <button key={`${result.conversation_id}-${result.message_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left text-sm hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/50 dark:hover:bg-slate-900" onClick={() => void openConversation(result.conversation_id)}><span className="font-semibold">{result.title} · {result.username || `#${result.user_id}`}</span><span className="mt-1 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">{result.snippet}</span></button>)}</div> : null}
            <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">{conversations.length ? conversations.map((conversation) => <div key={conversation.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50"><button className="block w-full text-left" onClick={() => void openConversation(conversation.id)}><p className="truncate text-sm font-medium">{conversation.title}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{conversation.username || `#${conversation.user_id}`} · {formatDate(conversation.updated_at)} · {conversation.message_count} 条</p><p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{conversation.last_message_preview || '暂无消息'}</p></button><DangerButton className="mt-3 text-xs" onClick={() => void deleteConversation(conversation.id)}><Trash2 size={14} />软删除</DangerButton></div>) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">暂无对话。</p>}</div>
              <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">{selectedConversation ? <><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{selectedConversation.title}</h3><p className="text-xs text-slate-500 dark:text-slate-400">{selectedConversation.username || `#${selectedConversation.user_id}`} · {formatDate(selectedConversation.created_at)}</p></div><DangerButton className="text-xs" onClick={() => void deleteConversation(selectedConversation.id)}><Trash2 size={14} />软删除</DangerButton></div>{selectedConversation.messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'ml-auto max-w-3xl rounded-2xl bg-sky-600 p-3 text-sm text-white' : 'mr-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900'}><p className="whitespace-pre-wrap">{message.content}</p>{message.sources.length ? <p className="mt-2 text-xs opacity-70">来源 {message.sources.length}</p> : null}</div>)}</> : <p className="text-sm text-slate-500 dark:text-slate-400">请选择一个对话查看详情。</p>}</div>
            </div>
          </Card>

          <Card className="space-y-4 p-5 xl:col-span-3">
            <div className="flex items-center gap-2"><MessagesSquare size={18} className="text-sky-600 dark:text-sky-200" /><div><h2 className="text-lg font-semibold">聊天日志</h2><p className="text-xs text-slate-500 dark:text-slate-400">展示最近的问答、来源和拦截记录。已删除/停用用户会保留标记。</p></div></div>
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {recentLogs.length ? recentLogs.map((log) => <div key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">{log.username}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDate(log.created_at)}</p></div><div className="flex flex-wrap gap-2"><Badge tone={log.blocked ? 'red' : 'green'}>{log.blocked ? '已拦截' : '已回答'}</Badge><Badge tone="neutral">来源 {log.sources.length}</Badge></div></div><div className="mt-3 space-y-3 text-sm"><div><p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">问题</p><p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{log.question}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">回答</p><p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{log.answer}</p></div>{log.sources.length ? <div className="space-y-2"><p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">检索来源</p>{log.sources.map((source: Source, index: number) => <div key={`${log.id}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"><p className="font-semibold text-sky-700 dark:text-sky-200">{source.document_name} · {source.location}</p><p className="mt-1 line-clamp-2">{source.preview}</p></div>)}</div> : null}</div></div>) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">暂无聊天日志。</p>}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
