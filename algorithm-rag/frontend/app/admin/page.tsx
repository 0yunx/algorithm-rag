'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type Key } from 'react';
import {
  AlertTriangle,
  Eye,
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
  X,
} from 'lucide-react';
import { api, clearToken, type ChatLog, type ConversationSearchResult, type ConversationSummary, type DocumentDetail, type DocumentItem, type Prompt, type RegistrationRequest, type Role, type Source, type User } from '@/lib/api';
import { kindLabel, statusLabel, statusTone } from '@/lib/labels';
import { MarkdownView } from '@/components/markdown-view';
import { Badge, Button, Card, DangerButton, Input, PasswordInput, SecondaryButton, Select, Textarea, ThemeToggle } from '@/components/ui';

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '无';
}

function formatLogDate(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
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
  const [deletedLogs, setDeletedLogs] = useState<ChatLog[]>([]);
  const [conversationResults, setConversationResults] = useState<ConversationSearchResult[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const [selectedLogUserId, setSelectedLogUserId] = useState<number | null>(null);
  const [documentDetail, setDocumentDetail] = useState<DocumentDetail | null>(null);

  // Conversation review state
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [conversationFilterStatus, setConversationFilterStatus] = useState<'active' | 'deleted'>('active');
  const [reviewConversations, setReviewConversations] = useState<ConversationSummary[]>([]);
  const [reviewConversationsLoading, setReviewConversationsLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [searchingUsers, setSearchingUsers] = useState(false);

  // Chat log table state
  const [activeLogTab, setActiveLogTab] = useState<'all' | 'filtered' | 'deleted' | 'conversations'>('all');
  const [logPage, setLogPage] = useState(1);
  const [selectedLogDetail, setSelectedLogDetail] = useState<ChatLog | null>(null);
  const [logActionId, setLogActionId] = useState<number | null>(null);
  const LOGS_PER_PAGE = 15;

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
  const [loadingDocumentId, setLoadingDocumentId] = useState<number | null>(null);

  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', role: 'people' as Role });

  const usersById = useMemo(() => Object.fromEntries(users.map((item) => [item.id, userDisplay(item)])), [users]);
  const pendingDocuments = useMemo(() => documents.filter((item) => item.status === 'pending_approval'), [documents]);
  const readyCount = useMemo(() => documents.filter((item) => item.status === 'ready').length, [documents]);
  const pendingCount = useMemo(() => documents.filter((item) => item.status === 'pending_approval').length, [documents]);
  const failedCount = useMemo(() => documents.filter((item) => item.status === 'failed').length, [documents]);
  const pendingRequests = useMemo(() => requests.filter((item) => item.status === 'pending'), [requests]);
  const filteredLogs = useMemo(() => {
    const term = chatSearch.trim().toLowerCase();
    return logs.filter((log) => {
      const matchesSelectedUser = selectedLogUserId === null || log.user_id === selectedLogUserId;
      if (!matchesSelectedUser) return false;
      if (!term) return true;
      return [log.username, log.email || '', log.question, log.answer]
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [chatSearch, logs, selectedLogUserId]);
  const filteredDeletedLogs = useMemo(() => {
    const term = chatSearch.trim().toLowerCase();
    return deletedLogs.filter((log) => {
      const matchesSelectedUser = selectedLogUserId === null || log.user_id === selectedLogUserId;
      if (!matchesSelectedUser) return false;
      if (!term) return true;
      return [log.username, log.email || '', log.question, log.answer]
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [chatSearch, deletedLogs, selectedLogUserId]);
  const matchingLogUsers = useMemo(() => {
    const term = chatSearch.trim().toLowerCase();
    if (!term) return [];
    const seen = new Set<number>();
    return [...logs, ...deletedLogs]
      .filter((log) => {
        if (seen.has(log.user_id)) return false;
        const matches = [log.username, log.email || ''].some((value) => value.toLowerCase().includes(term));
        if (matches) seen.add(log.user_id);
        return matches;
      })
      .slice(0, 8);
  }, [chatSearch, deletedLogs, logs]);

  const loadCore = useCallback(async (silent = false) => {
    if (silent) setRefreshingCore(true);
    else setLoadingCore(true);
    setPageError('');
    try {
      const [docs, userList, registrationRequests, activeChatLogs, deletedChatLogs] = await Promise.all([
        api.documents(),
        api.users(),
        api.registrationRequests(),
        api.chatLogs('active'),
        api.chatLogs('deleted'),
      ]);
      setDocuments(docs);
      setUsers(userList);
      setRequests(registrationRequests);
      setLogs(activeChatLogs);
      setDeletedLogs(deletedChatLogs);
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

  async function viewDocument(documentId: number) {
    setPageError('');
    setLoadingDocumentId(documentId);
    try {
      setDocumentDetail(await api.document(documentId));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '读取文档失败');
    } finally {
      setLoadingDocumentId(null);
    }
  }

  // --- Conversation review helpers ---

  async function searchUsersForReview(q: string) {
    setUserSearchQuery(q);
    if (!q.trim()) {
      setUserSearchResults([]);
      return;
    }
    setSearchingUsers(true);
    try {
      setUserSearchResults(await api.adminSearchUsers(q, 'people'));
    } catch {
      setUserSearchResults([]);
    } finally {
      setSearchingUsers(false);
    }
  }

  function addUserToFilter(user: User) {
    if (!selectedUsers.find((u) => u.id === user.id)) {
      setSelectedUsers((prev) => [...prev, user]);
    }
    setUserSearchQuery('');
    setUserSearchResults([]);
  }

  function removeUserFromFilter(userId: number) {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  }

  async function loadReviewConversations(status: 'active' | 'deleted') {
    setConversationFilterStatus(status);
    setReviewConversationsLoading(true);
    setReviewError('');
    try {
      const params: { status: typeof status; userIds?: number[] } = { status };
      if (selectedUsers.length > 0) {
        params.userIds = selectedUsers.map((u) => u.id);
      }
      setReviewConversations(await api.adminConversations(params));
      setReviewExpanded(true);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : '加载对话列表失败');
    } finally {
      setReviewConversationsLoading(false);
    }
  }

  function navigateToConversation(conversationId: number) {
    window.location.href = `/admin/conversations/${conversationId}`;
  }

  function renderSourceCard(source: Source, key: Key, className: string) {
    const sourceContent = (
      <>
        <p className="font-semibold text-sky-700 dark:text-sky-200">{source.document_name} · {source.location}</p>
        <MarkdownView content={source.preview} className="mt-1 line-clamp-3 text-xs text-slate-600 dark:text-slate-300" inline />
      </>
    );

    return source.document_id ? (
      <button
        key={key}
        type="button"
        className={`${className} w-full text-left transition hover:border-sky-300 hover:bg-sky-50/60 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:hover:border-sky-400/40 dark:hover:bg-sky-400/10`}
        onClick={() => void viewDocument(source.document_id)}
      >
        {sourceContent}
      </button>
    ) : (
      <div key={key} className={className}>{sourceContent}</div>
    );
  }

  async function selectLogUser(userId: number | null) {
    setSelectedLogUserId(userId);
    setPageError('');
    setConversationResults([]);
  }

  async function softDeleteChatLog(log: ChatLog) {
    if (!window.confirm(`确认删除这条聊天日志？可在已删除日志中恢复。`)) return;
    setPageError('');
    setLogActionId(log.id);
    try {
      await api.deleteChatLog(log.id);
      setSelectedLogDetail((current) => (current?.id === log.id ? null : current));
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除聊天日志失败');
    } finally {
      setLogActionId(null);
    }
  }

  async function restoreChatLog(log: ChatLog) {
    setPageError('');
    setLogActionId(log.id);
    try {
      await api.restoreChatLog(log.id);
      setSelectedLogDetail((current) => (current?.id === log.id ? null : current));
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '恢复聊天日志失败');
    } finally {
      setLogActionId(null);
    }
  }

  async function permanentlyDeleteChatLog(log: ChatLog) {
    if (!window.confirm('此操作将永久删除该聊天日志，且无法恢复。确认继续？')) return;
    setPageError('');
    setLogActionId(log.id);
    try {
      await api.permanentlyDeleteChatLog(log.id);
      setSelectedLogDetail((current) => (current?.id === log.id ? null : current));
      await loadCore(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '永久删除聊天日志失败');
    } finally {
      setLogActionId(null);
    }
  }

  async function searchConversationMessages() {
    const query = chatSearch.trim();
    if (!query) {
      setConversationResults([]);
      return;
    }
    setPageError('');
    try {
      setConversationResults(await api.adminSearchConversations(query, { userId: selectedLogUserId }));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '搜索会话失败');
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
                <Badge tone="red">已删除日志 {deletedLogs.length}</Badge>
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
                  <div className="mt-3 flex flex-wrap gap-2"><SecondaryButton className="text-xs" onClick={() => void viewDocument(document.id)} disabled={loadingDocumentId === document.id}>{loadingDocumentId === document.id ? <LoaderCircle size={14} className="animate-spin" /> : <Eye size={14} />}查看文档</SecondaryButton><Button className="text-xs" onClick={() => void approveDocument(document.id)} disabled={approvingId === document.id}>{approvingId === document.id ? <LoaderCircle size={14} className="animate-spin" /> : null}审核通过</Button></div>
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
                  <div className="mt-3 flex flex-wrap gap-2"><SecondaryButton className="text-xs" onClick={() => void viewDocument(document.id)} disabled={loadingDocumentId === document.id}>{loadingDocumentId === document.id ? <LoaderCircle size={14} className="animate-spin" /> : <Eye size={14} />}查看文档</SecondaryButton>{canRetry && <SecondaryButton className="text-xs" onClick={() => void retryDocument(document.id)} disabled={retryingId === document.id}>{retryingId === document.id ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}重试索引</SecondaryButton>}</div>
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

          {/* Conversation review module */}
          <Card className="space-y-4 p-5 xl:col-span-3">
            <div className="flex items-center gap-2">
              <MessagesSquare size={18} className="text-sky-600 dark:text-sky-200" />
              <div>
                <h2 className="text-lg font-semibold">对话审查</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">查看和管理用户对话，支持按用户筛选、隐藏和恢复。</p>
              </div>
            </div>

            {!reviewExpanded ? (
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void loadReviewConversations('active')}>查看全局对话</Button>
                <SecondaryButton onClick={() => { setReviewExpanded(true); }}>搜索用户</SecondaryButton>
                <SecondaryButton onClick={() => void loadReviewConversations('deleted')}>已隐藏 / 已软删除</SecondaryButton>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <SecondaryButton onClick={() => { setReviewExpanded(false); setReviewConversations([]); }}>收起</SecondaryButton>
                </div>

                {/* User search */}
                <div className="relative">
                  <div className="flex gap-2">
                    <Input
                      value={userSearchQuery}
                      onChange={(event) => { void searchUsersForReview(event.target.value); }}
                      placeholder="搜索用户（people）..."
                    />
                  </div>
                  {userSearchResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {userSearchResults.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-sky-50 dark:text-slate-200 dark:hover:bg-sky-400/10"
                          onClick={() => addUserToFilter(u)}
                        >
                          {u.username}{u.email ? ` · ${u.email}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected user tags */}
                {selectedUsers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedUsers.map((u) => (
                      <span key={u.id} className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200">
                        {u.username}
                        <button type="button" className="ml-0.5 rounded-full p-0.5 transition hover:bg-sky-200 dark:hover:bg-sky-400/20" onClick={() => removeUserFromFilter(u.id)} aria-label={`移除 ${u.username}`} title={`移除 ${u.username}`}>&times;</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void loadReviewConversations('active')} disabled={reviewConversationsLoading}>
                    {reviewConversationsLoading && conversationFilterStatus === 'active' ? <LoaderCircle size={14} className="animate-spin" /> : null}
                    查看全局对话
                  </Button>
                  <SecondaryButton onClick={() => void loadReviewConversations('deleted')} disabled={reviewConversationsLoading}>
                    {reviewConversationsLoading && conversationFilterStatus === 'deleted' ? <LoaderCircle size={14} className="animate-spin" /> : null}
                    已隐藏 / 已软删除
                  </SecondaryButton>
                </div>

                {/* Status badge */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge tone={conversationFilterStatus === 'active' ? 'green' : 'red'}>
                    {conversationFilterStatus === 'active' ? '活跃对话' : '已隐藏 / 已软删除'}
                  </Badge>
                  {selectedUsers.length > 0 && (
                    <Badge tone="blue">已筛选 {selectedUsers.length} 个用户</Badge>
                  )}
                  <Badge tone="neutral">{reviewConversations.length} 个对话</Badge>
                </div>

                {reviewError && (
                  <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{reviewError}</p>
                )}

                {/* Conversation summary cards */}
                <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {reviewConversations.length ? reviewConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className="rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm shadow-sm transition hover:border-sky-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-400/40"
                      onClick={() => navigateToConversation(conversation.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{conversation.title}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {conversation.username || `用户 #${conversation.user_id}`}
                            {conversation.email ? ` · ${conversation.email}` : ''}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{formatDate(conversation.updated_at)}</p>
                        </div>
                        <Badge tone="neutral">{conversation.message_count} 条</Badge>
                      </div>
                      {conversation.last_message_preview && (
                        <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{conversation.last_message_preview}</p>
                      )}
                    </button>
                  )) : (
                    <p className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                      {reviewConversationsLoading ? '加载中...' : '暂无对话。'}
                    </p>
                  )}
                </div>
              </>
            )}
          </Card>

          {/* Chat logs */}
          <Card className="space-y-4 p-5 xl:col-span-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-center gap-2"><MessagesSquare size={18} className="text-sky-600 dark:text-sky-200" /><div><h2 className="text-lg font-semibold">聊天日志</h2><p className="text-xs text-slate-500 dark:text-slate-400">全局展示最近的问答、来源和拦截记录；可按用户名、邮箱、问题或回答搜索。已删除/停用用户会保留标记。</p></div></div>
              <div className="min-w-0 lg:w-96">
                <div className="flex gap-2">
                  <Input value={chatSearch} onChange={(event) => { setChatSearch(event.target.value); setLogPage(1); }} placeholder="搜索用户名、邮箱、问题或回答" />
                  <SecondaryButton className="shrink-0" onClick={() => { setActiveLogTab('conversations'); void searchConversationMessages(); }}>搜索会话</SecondaryButton>
                </div>
                {selectedLogUserId !== null && <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200"><span>正在查看用户：{[...logs, ...deletedLogs].find((log) => log.user_id === selectedLogUserId)?.username || `#${selectedLogUserId}`}</span><button type="button" className="font-semibold underline underline-offset-2" onClick={() => void selectLogUser(null)}>返回全局</button></div>}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-0 border-b border-slate-200 dark:border-slate-700">
              {([
                { key: 'all' as const, label: '全局日志', count: logs.length },
                { key: 'filtered' as const, label: '当前显示', count: filteredLogs.length },
                { key: 'deleted' as const, label: '已删除日志', count: filteredDeletedLogs.length },
                { key: 'conversations' as const, label: '会话', count: conversationResults.length },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                    activeLogTab === tab.key
                      ? 'border-b-2 border-sky-500 text-sky-600 dark:text-sky-200'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  onClick={() => { setActiveLogTab(tab.key); setLogPage(1); setSelectedLogDetail(null); }}
                >
                  {tab.label}
                  <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
                </button>
              ))}
            </div>

            {/* Matching users */}
            {matchingLogUsers.length > 0 && activeLogTab !== 'conversations' && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">匹配用户，点击查看该用户的所有会话：</p>
                <div className="flex flex-wrap gap-2">
                  {matchingLogUsers.map((log) => (
                    <SecondaryButton key={log.user_id} className="text-xs" onClick={() => void selectLogUser(log.user_id)}>
                      {log.username}{log.email ? ` · ${log.email}` : ''}
                    </SecondaryButton>
                  ))}
                </div>
              </div>
            )}

            {/* Conversations tab */}
            {activeLogTab === 'conversations' && (
              conversationResults.length > 0 ? (
                <div className="overflow-hidden rounded-xl">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">时间</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">用户名</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">会话标题</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">内容摘要</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversationResults.map((result) => (
                        <tr key={`${result.conversation_id}-${result.message_id}`} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800/50 dark:hover:bg-slate-800/30">
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-[#cdd6f4]">{formatLogDate(result.created_at)}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-[#cdd6f4]">{result.username || `#${result.user_id}`}</td>
                          <td className="max-w-[200px] truncate px-4 py-3 text-slate-700 dark:text-[#cdd6f4]">{result.title}</td>
                          <td className="max-w-[200px] truncate px-4 py-3 text-slate-500 dark:text-[#cdd6f4]/70">{result.snippet.length > 20 ? `${result.snippet.slice(0, 20)}...` : result.snippet}</td>
                          <td className="px-4 py-3">
                            <SecondaryButton className="text-xs" onClick={() => { window.location.href = `/admin/conversations/${result.conversation_id}`; }}>查看会话</SecondaryButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">请搜索会话消息进行查看。</p>
              )
            )}

            {/* Logs tabs (all / filtered / deleted) */}
            {activeLogTab !== 'conversations' && (() => {
              const sourceData = activeLogTab === 'all' ? logs : activeLogTab === 'deleted' ? filteredDeletedLogs : filteredLogs;
              const totalPages = Math.max(1, Math.ceil(sourceData.length / LOGS_PER_PAGE));
              const safePage = Math.min(logPage, totalPages);
              const pageStart = sourceData.length === 0 ? 0 : (safePage - 1) * LOGS_PER_PAGE;
              const pagedData = sourceData.slice(pageStart, safePage * LOGS_PER_PAGE);
              const isDeletedTab = activeLogTab === 'deleted';
              const rowOffset = pageStart;

              if (sourceData.length === 0) {
                return (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">暂无匹配的聊天日志。</p>
                );
              }

              return (
                <>
                  <div className="overflow-hidden rounded-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">时间</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">用户名</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">问题</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">状态</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">来源</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#cdd6f4]">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedData.map((log, index) => (
                          <tr key={log.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800/50 dark:hover:bg-slate-800/30">
                            <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-[#cdd6f4]">
                              <span className="mr-2 text-xs text-slate-400 dark:text-slate-500">#{rowOffset + index + 1}</span>{formatLogDate(log.created_at)}
                              {isDeletedTab && log.deleted_at ? <p className="mt-1 text-xs text-red-500 dark:text-red-300">删除：{formatDate(log.deleted_at)}</p> : null}
                            </td>
                            <td className="px-4 py-3 text-slate-700 dark:text-[#cdd6f4]">{log.username}</td>
                            <td className="max-w-[200px] truncate px-4 py-3 text-slate-700 dark:text-[#cdd6f4]">{log.question.length > 20 ? `${log.question.slice(0, 20)}...` : log.question}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col items-start gap-1">
                                <span className={`font-medium ${log.blocked ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                  {log.blocked ? '已拦截' : '已回答'}
                                </span>
                                {isDeletedTab ? <Badge tone="red">已删除</Badge> : null}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-[#cdd6f4]">{log.sources.length}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <SecondaryButton className="text-xs" onClick={() => setSelectedLogDetail(log)}>
                                  查看详情
                                </SecondaryButton>
                                {isDeletedTab ? (
                                  <>
                                    <SecondaryButton className="text-xs" onClick={() => void restoreChatLog(log)} disabled={logActionId === log.id}>
                                      {logActionId === log.id ? <LoaderCircle size={14} className="animate-spin" /> : null}恢复
                                    </SecondaryButton>
                                    <DangerButton className="text-xs" onClick={() => void permanentlyDeleteChatLog(log)} disabled={logActionId === log.id}>
                                      永久删除
                                    </DangerButton>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="text-xs text-slate-400 transition hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-500 dark:hover:text-red-400"
                                    onClick={() => void softDeleteChatLog(log)}
                                    disabled={logActionId === log.id}
                                    title="删除此条"
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>共 {sourceData.length} 条记录</span>
                    <div className="flex items-center gap-2">
                      <SecondaryButton className="text-xs" disabled={safePage <= 1} onClick={() => setLogPage((p) => Math.max(1, p - 1))}>上一页</SecondaryButton>
                      <span className="tabular-nums">第 {safePage} / {totalPages} 页</span>
                      <SecondaryButton className="text-xs" disabled={safePage >= totalPages} onClick={() => setLogPage((p) => Math.min(totalPages, p + 1))}>下一页</SecondaryButton>
                    </div>
                  </div>
                </>
              );
            })()}
          </Card>
        </div>
      </div>
      {selectedLogDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <Card className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
              <div className="min-w-0">
                <h2 className="text-lg font-bold">日志详情 · {selectedLogDetail.username}</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  #{selectedLogDetail.id} · 用户 #{selectedLogDetail.user_id}{selectedLogDetail.email ? ` · ${selectedLogDetail.email}` : ''} · 创建：{formatLogDate(selectedLogDetail.created_at)}
                  {selectedLogDetail.deleted_at ? ` · 删除：${formatDate(selectedLogDetail.deleted_at)}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone={selectedLogDetail.blocked ? 'red' : 'green'}>{selectedLogDetail.blocked ? '已拦截' : '已回答'}</Badge>
                  {selectedLogDetail.deleted_at ? <Badge tone="red">已删除</Badge> : null}
                  <Badge tone="neutral">来源 {selectedLogDetail.sources.length}</Badge>
                </div>
              </div>
              <DangerButton className="px-3" onClick={() => setSelectedLogDetail(null)} aria-label="关闭日志详情" title="关闭日志详情"><X size={16} /></DangerButton>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/60 p-5 dark:bg-slate-950/40">
              <section>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">问题</p>
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <MarkdownView content={selectedLogDetail.question} className="text-slate-800 dark:text-slate-100" />
                </div>
              </section>
              <section>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">回答</p>
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <MarkdownView content={selectedLogDetail.answer} className="text-slate-700 dark:text-slate-200" />
                </div>
              </section>
              <section>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">检索来源</p>
                {selectedLogDetail.sources.length > 0 ? (
                  <div className="space-y-2">
                    {selectedLogDetail.sources.map((source: Source, index: number) => renderSourceCard(source, `${selectedLogDetail.id}-${index}`, 'rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">无检索来源。</p>
                )}
              </section>
            </div>
          </Card>
        </div>
      )}
      {documentDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <Card className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
              <div className="min-w-0">
                <h2 className="break-all text-lg font-bold">{documentDetail.filename}</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">#{documentDetail.id} · {kindLabel(documentDetail.kind)} · {statusLabel(documentDetail.status)} · 上传者 {usersById[documentDetail.uploaded_by] || `#${documentDetail.uploaded_by}`}</p>
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
