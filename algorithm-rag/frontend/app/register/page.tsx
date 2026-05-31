'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ClipboardCheck, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, Input, PasswordInput, Textarea, ThemeToggle } from '@/components/ui';

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', username: '', password: '', confirmPassword: '', reason: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const email = form.email.trim();
    const username = form.username.trim();
    if (!email.includes('@')) {
      setError('请输入有效邮箱');
      return;
    }
    if (!username) {
      setError('请输入用户名');
      return;
    }
    if (form.password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await api.register({ email, username, password: form.password, reason: form.reason.trim() || undefined });
      setSuccess('注册申请已提交，请等待管理员审批。审批通过后即可登录。');
      setForm({ email: '', username: '', password: '', confirmPassword: '', reason: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交注册申请失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-5">
        <div className="flex justify-end"><ThemeToggle /></div>
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"><UserPlus /></div>
              <div>
                <h1 className="text-2xl font-bold">申请加入算法 RAG</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">提交后不会自动登录，需要管理员审批。</p>
              </div>
            </div>
          </div>
          <form className="space-y-5 p-8" onSubmit={onSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium">
                <span>邮箱</span>
                <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="请输入邮箱" />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>用户名</span>
                <Input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="请输入用户名" />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium">
                <span>密码</span>
                <PasswordInput value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="至少 6 位" autoComplete="new-password" />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>确认密码</span>
                <PasswordInput value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} placeholder="再次输入密码" autoComplete="new-password" />
              </label>
            </div>
            <label className="block space-y-2 text-sm font-medium">
              <span>申请理由（可选）</span>
              <Textarea rows={4} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="说明你的使用场景，方便管理员审核" />
            </label>
            {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{error}</p>}
            {success && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"><ClipboardCheck size={16} />{success}</p>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link className="text-sm font-semibold text-sky-600 hover:text-sky-500 dark:text-sky-300" href="/login">返回登录</Link>
              <Button disabled={loading}>{loading ? '提交中...' : '提交注册申请'}</Button>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}
