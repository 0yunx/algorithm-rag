# Algorithm RAG

本项目是一个本地运行的算法知识库 RAG 应用，前端使用 Next.js，后端使用 FastAPI，并提供基于角色的用户、审核和管理能力。

## 功能概览

- 支持 `admin` 管理员和 `people` 普通用户角色登录。
- 公开注册页会提交注册申请，只有管理员审批通过后才能登录。
- 普通用户可以聊天，也可以提交 PDF/Markdown 文档等待管理员审核。
- 管理员可以直接上传文档、审核用户文档、重试索引、审批注册申请、创建用户、重置密码、软删除用户、编辑当前系统 Prompt，并查看聊天日志。
- SQLite 保存用户、注册申请、文档、Prompt 和聊天日志。
- 用户采用软删除，历史文档和聊天日志会继续保留。
- ChromaDB 保存算法文档向量。
- BGE-M3 在本地执行向量嵌入。
- 对话生成使用 `.env` 中配置的 OpenAI 兼容 API。

## 环境配置

运行时、模型和路径配置放在仓库根目录或 `algorithm-rag/.env`：

```env
OPENAI_API_KEY=...
OPENAI_BASE_URL=...
CHAT_MODEL=...

EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DEVICE=cpu
# 相对路径按仓库根目录解析
EMBEDDING_CACHE_DIR=.venv/huggingface

DATABASE_URL=sqlite:///./data/app.db
CHROMA_DIR=./data/chroma
UPLOAD_DIR=./data/uploads

JWT_SECRET_KEY=replace-with-a-long-random-string
JWT_EXPIRE_MINUTES=1440

RAG_TOP_K=8
RERANK_TOP_K=4
MAX_UPLOAD_MB=20
FRONTEND_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

应用账号由数据库管理，不从 `.env` 读取或预置用户凭证。

## 数据库初始化与维护

默认 SQLite 数据库位置是 `algorithm-rag/data/app.db`。当 `DATABASE_URL=sqlite:///./data/app.db` 或未配置 `DATABASE_URL` 时，后端会解析到该文件；目录不存在时会自动创建。

首次部署或升级已有本地库时，建议先执行初始化命令：

```bash
cd algorithm-rag/backend
python seed.py init-db
```

`python seed.py init-db` 会执行以下操作：

1. 创建 SQLAlchemy 模型声明的所有表。
2. 对 SQLite 执行轻量迁移：补齐 `users.email`、`users.is_builtin`、`users.deleted_at` 等字段，重建早期带 username 唯一约束的旧版 `users` 表，并创建活跃用户/开放注册申请的唯一索引。
3. 如果缺少内置管理员，则创建内置管理员；如果已存在，则只确保其角色、启用状态和保护标记正确，不覆盖已有密码。
4. 如果缺少启用中的默认 Prompt，则写入默认系统 Prompt。

后端启动时也会调用相同的初始化路径，确保表结构、轻量迁移、内置管理员和默认 Prompt 就绪。

### 数据表说明

- `users`：登录用户表，包含用户名、邮箱、密码哈希、角色、启用状态、内置账号标记、创建时间和软删除时间。
- `registration_requests`：注册申请表，保存邮箱、用户名、申请理由、审批状态、审批人和审批时间。
- `documents`：文档元数据表，保存文件名、存储路径、文档类型、审核/索引状态、错误信息、上传人、审批人和时间戳。
- `prompts`：系统 Prompt 表，保存 Prompt 名称、内容、生效状态和更新时间。
- `chat_logs`：聊天日志表，保存提问、回答、检索来源、是否被拦截、用户和创建时间。

### 常用 SQL 查询

查看用户列表示例：

```sql
SELECT id, username, email, role, is_active, is_builtin, created_at, deleted_at
FROM users
ORDER BY created_at DESC;
```

### 重置内置管理员密码

如需在不删除应用数据的情况下重置或补建内置管理员：

```bash
cd algorithm-rag/backend
python seed.py reset-admin
```

该命令会将内置管理员恢复为启用状态和管理员角色，并重置为初始密码；文档、聊天日志、Prompt、普通用户和注册申请历史都会保留。

## 内置管理员与账号规则

- 内置管理员账号：`admin`。
- 内置管理员是数据库账号，带 `is_builtin` 保护标记，不能在后台被软删除。
- 内置管理员不依赖 `.env` 用户凭证；`.env` 只配置模型、路径、JWT 和跨域等运行参数。
- `init-db` 只在缺少内置管理员时创建初始密码；后续启动不会覆盖已修改的管理员密码。
- 如需显式恢复初始密码，请执行 `python seed.py reset-admin`。
- 系统没有默认 `tourist` 或其他普通用户。
- 新用户应从前端 `/register` 提交申请。申请会保存 bcrypt 密码哈希，等待管理员审批。
- 管理员在后台通过或拒绝申请；通过后会创建 `people` 用户，拒绝会保留历史且允许后续重新提交。

## 初始化并导入样例算法知识

为了方便本地演示，可以直接导入内置的中文算法知识样例，包含二分答案、前缀和、矩阵快速幂、树状数组、CDQ 分治、双指针/滑动窗口、BFS/DFS 等常见模式。算法知识源会先写入 SQLite 的 `algorithm_entries` 表，再同步索引到 ChromaDB 向量库。

```bash
cd algorithm-rag/backend
python seed.py init-db
python seed.py seed-algorithms
```

`seed-algorithms` 会先确保 SQLite 表结构、内置管理员和默认 Prompt 已初始化，然后幂等创建或更新内置算法条目，创建或更新 `documents` 中的稳定记录，并通过现有 ChromaDB 向量存储写入分块嵌入。该命令可以重复执行：SQLite 条目会更新，向量分块会重建，不会重复创建文档。

运行该命令不需要配置 OpenAI 聊天 API，也不需要安装 `openai` 包；但需要本地向量依赖 `sentence-transformers`、`chromadb` 等后端依赖。若缺少 BGE-M3 / sentence-transformers 相关依赖，请执行：

```bash
python -m pip install -r requirements.txt
```

首次运行 BGE-M3 会下载模型权重到仓库根目录 `.venv/huggingface`；完全离线环境请提前准备该目录下的 Hugging Face 模型缓存。

## 本地启动（前后端）

以下命令均从仓库根目录执行。后端和前端是两个独立进程，启动前端不会自动启动后端。

### 一次性环境准备

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r .\algorithm-rag\backend\requirements.txt
npm --prefix .\algorithm-rag\frontend install
```

如果前端依赖已经安装，可以跳过 `npm install`。但如果刚执行过 `git pull`，且前端出现 `Module not found`、Build Error 或登录页无法打开，请从仓库根目录重新运行 `npm --prefix .\algorithm-rag\frontend install`，同步别人新增到 `package.json` / `package-lock.json` 的依赖。根目录 `.venv` 是后端 Python 环境；BGE-M3 模型缓存位于 `.venv\huggingface`。

### 启动后端

在第一个终端中从仓库根目录运行，并保持该终端持续运行：

```powershell
& .\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir .\algorithm-rag\backend
```

如已进入 `algorithm-rag/backend` 且已激活根目录 `.venv`，也可以运行：

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

首次运行 BGE-M3 会下载模型权重到仓库根目录 `.venv/huggingface`。完全离线环境请提前准备该目录下的 Hugging Face 模型缓存。

### 启动前端

在第二个终端中从仓库根目录运行，并保持该终端持续运行：

```powershell
npm --prefix .\algorithm-rag\frontend run dev
```

如已进入 `algorithm-rag/frontend`，也可以运行：

```powershell
npm run dev
```

前端默认通过 `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` 访问后端。

### 访问地址

- 前端登录页：`http://localhost:3000/login`
- 后端接口文档：`http://127.0.0.1:8000/docs`

如果在 CLI 中请求本地地址返回 502，通常是代理拦截了 localhost；请为 localhost/127.0.0.1 绕过代理，或直接用浏览器访问上述地址。
