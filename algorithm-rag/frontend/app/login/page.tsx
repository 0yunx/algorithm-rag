'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrainCircuit, ShieldCheck, Sparkles } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { Button, Card, Input, PasswordInput, ThemeToggle } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.login(username, password);
      setToken(result.access_token);
      router.push('/chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden border-r border-slate-200 bg-white/70 p-10 dark:border-slate-800 dark:bg-slate-950/40 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"><BrainCircuit /></div>
          <div>
            <h1 className="text-xl font-bold">算法 RAG</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">面向算法知识库的团队问答平台</p>
          </div>
        </div>
        <div className="max-w-xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200">
            <Sparkles size={16} /> 专业级 SaaS 工作台体验
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-slate-950 dark:text-white">检索、审核、沉淀你的算法学习资料。</h2>
          <p className="text-lg leading-8 text-slate-600 dark:text-slate-300">管理员控制资料入库和账号审批，成员可以上传文档并使用 RAG 助手进行算法、数据结构与复杂度相关问答。</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {['注册审批', '文档审核', '系统提示词管理', '聊天日志'].map((item) => <div key={item} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">{item}</div>)}
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">默认账号信息请查看 README；登录页不展示密码。</p>
      </section>

      <section className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-5">
          <div className="flex justify-end"><ThemeToggle /></div>
          <Card className="p-8">
            <div className="mb-8 space-y-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"><ShieldCheck /></div>
                <div>
                  <h1 className="text-2xl font-bold">登录工作台</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400">使用已批准的账号访问系统</p>
                </div>
              </div>
            </div>
            <form className="space-y-4" onSubmit={onSubmit}>
              <label className="block space-y-2 text-sm font-medium">
                <span>用户名</span>
                <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="请输入用户名" />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>密码</span>
                <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="输入密码" />
              </label>
              {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{error}</p>}
              <Button className="w-full" disabled={loading}>{loading ? '登录中...' : '登录'}</Button>
            </form>
            <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
              还没有账号？ <Link className="font-semibold text-sky-600 hover:text-sky-500 dark:text-sky-300" href="/register">提交注册申请</Link>
            </p>
          </Card>
        </div>
      </section>
    </main>
  );
}
