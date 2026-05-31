import argparse

from sqlalchemy.orm import Session

from auth import hash_password
from database import AlgorithmEntry, Document, DocumentKind, DocumentStatus, Prompt, SessionLocal, User, UserRole, create_tables
from document_processor import Chunk, chunk_text
from prompts import DEFAULT_PROMPT

BUILTIN_ADMIN_USERNAME = "admin"
BUILTIN_ADMIN_INITIAL_PASSWORD = "qwer4130874"
ALGORITHM_KNOWLEDGE_DOCUMENT_PATH = "sqlite://algorithm_entries/default"
ALGORITHM_KNOWLEDGE_DOCUMENT_NAME = "内置算法知识库"

DEFAULT_ALGORITHM_ENTRIES = [
    {
        "title": "二分答案",
        "category": "搜索与判定",
        "difficulty": "基础",
        "tags": "二分, 单调性, 判定函数, 最小化最大值, 最大化最小值",
        "content": """二分答案适合用于“最小化最大值”或“最大化最小值”问题。关键是把原问题转化成一个单调判定函数：当答案 x 可行时，所有更宽松的答案也可行；当答案 x 不可行时，所有更严格的答案也不可行。

常见步骤：
1. 明确答案范围 [left, right]。
2. 编写 check(mid) 判断当前答案是否满足约束。
3. 根据目标是找最小可行值还是最大可行值，收缩区间。
4. 循环结束后返回边界值。

典型题型包括运货能力、分割数组最大和、吃香蕉速度、最小化最大距离等。难点通常不在二分模板，而在证明判定条件具有单调性。""",
    },
    {
        "title": "前缀和",
        "category": "数据结构与预处理",
        "difficulty": "基础",
        "tags": "前缀和, 区间查询, 子数组, 二维前缀和, 差分",
        "content": """前缀和用于快速查询连续区间的累计值。对于数组 nums，定义 prefix[i + 1] = prefix[i] + nums[i]，则区间 [l, r] 的和为 prefix[r + 1] - prefix[l]。

二维前缀和可以在常数时间内查询矩形区域和。若 sum[i][j] 表示左上角到 (i - 1, j - 1) 的总和，则任意矩形可以通过容斥计算。

适用场景：
- 多次区间求和查询。
- 子数组和等于目标值。
- 差分数组配合区间更新。
- 统计固定窗口或矩形区域指标。

实现时建议使用长度 n + 1 的前缀数组，减少边界分支。""",
    },
    {
        "title": "矩阵快速幂",
        "category": "数学与线性递推",
        "difficulty": "进阶",
        "tags": "矩阵快速幂, 快速幂, 线性递推, Fibonacci, 状态转移",
        "content": """矩阵快速幂用于加速线性递推。若状态向量 S(n) 可以表示为 A * S(n - 1)，则 S(n) = A^(n-k) * S(k)。通过快速幂把矩阵幂从 O(n) 降到 O(log n) 次矩阵乘法。

常见步骤：
1. 设计状态向量，通常包含递推式需要的若干前项。
2. 构造转移矩阵，使一次矩阵乘法等价于递推一步。
3. 使用二进制快速幂计算矩阵幂。
4. 将矩阵幂乘以初始状态得到答案。

典型题型包括 Fibonacci 变体、线性递推求第 n 项、带固定维度状态转移的计数问题。注意矩阵乘法中的取模和维度顺序。""",
    },
    {
        "title": "树状数组",
        "category": "数据结构",
        "difficulty": "进阶",
        "tags": "树状数组, Fenwick, 单点更新, 前缀查询, 逆序对",
        "content": """树状数组 Fenwick Tree 用 lowbit 维护若干段前缀信息，支持单点更新和前缀查询，常见复杂度为 O(log n)。它适合维护可结合的信息，例如区间和、频次数组和前缀计数。

核心操作：
- lowbit(x) = x & -x。
- add(i, delta)：沿 i += lowbit(i) 更新覆盖该点的节点。
- sum(i)：沿 i -= lowbit(i) 汇总前缀 [1, i]。
- range_sum(l, r) = sum(r) - sum(l - 1)。

常见应用包括动态前缀和、逆序对统计、离散化后排名计数、区间更新单点查询。实现通常使用 1-based 下标，避免 lowbit(0) 导致死循环。""",
    },
    {
        "title": "CDQ 分治",
        "category": "分治与离线算法",
        "difficulty": "高级",
        "tags": "CDQ分治, 离线算法, 三维偏序, 树状数组, 归并思想",
        "content": """CDQ 分治是一种处理离线贡献统计的分治技术，常用于偏序问题和动态过程转静态分析。它按时间或某一维度分治，只统计左半部分对右半部分的贡献，再递归处理两边内部贡献。

典型流程：
1. 按主维度排序或按操作时间划分区间。
2. 递归处理左半和右半。
3. 在合并阶段，用排序、双指针、树状数组等结构统计跨区间贡献。
4. 清理辅助数据结构，避免影响其他分治层。

常见应用包括三维偏序、动态逆序对、离线修改查询。关键是保证贡献方向只从左到右，且每层统计后恢复现场。""",
    },
    {
        "title": "双指针与滑动窗口",
        "category": "数组与字符串",
        "difficulty": "基础",
        "tags": "双指针, 滑动窗口, 字符串, 子数组, 单调性",
        "content": """双指针常用于有序数组、链表和字符串扫描。滑动窗口是双指针的一种，维护 [left, right] 区间并在右指针扩展、左指针收缩之间保持窗口性质。

固定窗口适合长度固定的问题，例如长度为 k 的最大平均值。可变窗口适合“最长/最短满足条件子串”问题，例如无重复字符最长子串、最小覆盖子串、和至少为目标值的最短子数组。

设计窗口时要明确：
1. 窗口内维护哪些状态。
2. 什么时候扩展右端。
3. 什么时候收缩左端。
4. 在扩展前、扩展后、收缩前还是收缩后更新答案。""",
    },
    {
        "title": "BFS 与 DFS",
        "category": "图论与搜索",
        "difficulty": "基础",
        "tags": "BFS, DFS, 图遍历, 最短路, 回溯, 连通块",
        "content": """BFS 使用队列按层遍历，适合无权图最短路、层序遍历、最少步数问题。DFS 使用递归或栈深入搜索，适合连通块、回溯、拓扑相关遍历和树形问题。

BFS 常见模板：
- 初始化队列和 visited 集合。
- 每次弹出当前节点。
- 遍历相邻节点，未访问则标记并入队。
- 若需要层数，按队列当前长度分层处理。

DFS 常见注意点：
- 递归终止条件。
- visited 标记避免重复访问。
- 回溯问题中进入分支前选择，退出分支后撤销选择。
- 大图递归可能栈溢出，可改为显式栈。""",
    },
    {
        "title": "动态规划",
        "category": "动态规划",
        "difficulty": "进阶",
        "tags": "动态规划, 状态设计, 状态转移, 背包, 最优子结构",
        "content": """动态规划适合具有重叠子问题和最优子结构的问题。核心是定义状态、写出转移、确定初始化和遍历顺序。

常见状态设计：
- dp[i] 表示前 i 个元素的最优值。
- dp[i][j] 表示两个维度共同约束下的最优值。
- 背包问题中 dp[j] 表示容量为 j 时的最优值。

判断遍历顺序时，要保证转移依赖的状态已经计算完成。对于 0/1 背包，容量通常倒序遍历；对于完全背包，容量通常正序遍历。调试时优先检查状态含义是否稳定、初始化是否覆盖边界、答案是否需要从多个状态中取最优。""",
    },
    {
        "title": "贪心",
        "category": "算法思想",
        "difficulty": "基础",
        "tags": "贪心, 排序, 交换论证, 区间调度, 不变式",
        "content": """贪心每一步选择局部最优，并要求局部最优能推导出全局最优。使用贪心时需要能说明交换论证、排序依据或不变式。

常见贪心模式：
- 区间调度：按结束时间排序选择最多不重叠区间。
- 合并区间：按起点排序并维护当前最远右端。
- 跳跃游戏：维护当前能到达的最远位置。
- 分发资源：排序后优先满足最紧约束。

贪心代码通常很短，但正确性证明比实现更重要。如果无法证明局部选择不会破坏全局最优，应考虑动态规划或搜索。""",
    },
]


def init_db() -> None:
    """Create tables, run lightweight migrations, and insert required defaults."""
    create_tables()
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == BUILTIN_ADMIN_USERNAME, User.deleted_at.is_(None)).first()
        if not admin:
            db.add(
                User(
                    username=BUILTIN_ADMIN_USERNAME,
                    password_hash=hash_password(BUILTIN_ADMIN_INITIAL_PASSWORD),
                    role=UserRole.admin,
                    is_active=True,
                    is_builtin=True,
                )
            )
        else:
            admin.role = UserRole.admin
            admin.is_active = True
            admin.is_builtin = True
            admin.deleted_at = None

        if not db.query(Prompt).filter(Prompt.is_active.is_(True)).first():
            db.add(Prompt(name="default", content=DEFAULT_PROMPT, is_active=True))

        db.commit()
    finally:
        db.close()


def reset_admin() -> None:
    create_tables()
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == BUILTIN_ADMIN_USERNAME, User.deleted_at.is_(None)).first()
        if not admin:
            admin = User(username=BUILTIN_ADMIN_USERNAME, role=UserRole.admin, is_active=True, is_builtin=True)
            db.add(admin)
        admin.password_hash = hash_password(BUILTIN_ADMIN_INITIAL_PASSWORD)
        admin.role = UserRole.admin
        admin.is_active = True
        admin.is_builtin = True
        admin.deleted_at = None
        db.commit()
    finally:
        db.close()


def _admin_user(db: Session) -> User:
    admin = db.query(User).filter(User.username == BUILTIN_ADMIN_USERNAME, User.deleted_at.is_(None)).first()
    if not admin:
        raise RuntimeError("数据库初始化后仍未找到内置管理员，请先执行 python seed.py init-db")
    return admin


def ensure_default_algorithm_entries(db: Session) -> list[AlgorithmEntry]:
    """Ensure bundled algorithm knowledge rows exist and return all indexed entries."""
    for entry_data in DEFAULT_ALGORITHM_ENTRIES:
        entry = db.query(AlgorithmEntry).filter(AlgorithmEntry.title == entry_data["title"]).first()
        if not entry:
            db.add(AlgorithmEntry(**entry_data))
            continue
        for field in ("category", "difficulty", "tags", "content"):
            setattr(entry, field, entry_data[field])
    db.commit()
    return db.query(AlgorithmEntry).order_by(AlgorithmEntry.category.asc(), AlgorithmEntry.title.asc()).all()


def _algorithm_entry_text(entry: AlgorithmEntry) -> str:
    return "\n".join(
        [
            f"# {entry.title}",
            f"分类：{entry.category}",
            f"难度：{entry.difficulty}",
            f"标签：{entry.tags}",
            "",
            entry.content.strip(),
        ]
    )


def algorithm_entry_chunks(entries: list[AlgorithmEntry]) -> list[Chunk]:
    chunks: list[Chunk] = []
    for entry in entries:
        chunks.extend(chunk_text(_algorithm_entry_text(entry), entry.title))
    return chunks


def seed_algorithms() -> int:
    """Seed bundled algorithm entries into SQLite and index them in Chroma idempotently."""
    init_db()

    db = SessionLocal()
    try:
        admin = _admin_user(db)
        entries = ensure_default_algorithm_entries(db)
        if not entries:
            raise RuntimeError("SQLite 中没有可索引的算法知识条目")

        stored_path = ALGORITHM_KNOWLEDGE_DOCUMENT_PATH
        filename = ALGORITHM_KNOWLEDGE_DOCUMENT_NAME
        document = db.query(Document).filter(Document.stored_path == stored_path).first()
        if not document:
            document = Document(
                filename=filename,
                stored_path=stored_path,
                kind=DocumentKind.markdown,
                status=DocumentStatus.processing,
                uploaded_by=admin.id,
                approved_by=admin.id,
            )
            db.add(document)
            db.commit()
            db.refresh(document)
        else:
            document.filename = filename
            document.kind = DocumentKind.markdown
            document.status = DocumentStatus.processing
            document.error_message = None
            document.uploaded_by = document.uploaded_by or admin.id
            document.approved_by = admin.id
            db.commit()
            db.refresh(document)

        chunks = algorithm_entry_chunks(entries)
        if not chunks:
            raise RuntimeError("SQLite 算法知识条目没有生成可索引文本")

        from vector_store import replace_document_chunks

        replace_document_chunks(
            document.id,
            document.filename,
            [{"text": chunk.text, "location": chunk.location} for chunk in chunks],
        )
        document.status = DocumentStatus.ready
        document.error_message = None
        db.commit()
        return len(chunks)
    except (ImportError, ModuleNotFoundError, RuntimeError) as exc:
        db.rollback()
        message = str(exc)
        if "document" in locals() and document.id:
            failed_document = db.get(Document, document.id)
            if failed_document:
                failed_document.status = DocumentStatus.failed
                failed_document.error_message = message
                db.commit()
        if isinstance(exc, (ImportError, ModuleNotFoundError)) or "sentence-transformers" in message or "SentenceTransformer" in message:
            raise RuntimeError(
                "缺少本地向量嵌入依赖 sentence-transformers / BGE-M3。"
                "请在 algorithm-rag/backend 目录执行：python -m pip install -r requirements.txt，"
                "首次运行会下载 BAAI/bge-m3 模型；如在离线环境，请提前准备 Hugging Face 模型缓存。"
            ) from exc
        raise
    except Exception as exc:
        db.rollback()
        if "document" in locals() and document.id:
            failed_document = db.get(Document, document.id)
            if failed_document:
                failed_document.status = DocumentStatus.failed
                failed_document.error_message = str(exc)
                db.commit()
        raise
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="后端数据库维护命令")
    parser.add_argument("command", choices=["init-db", "reset-admin", "seed-algorithms"])
    args = parser.parse_args()
    if args.command == "init-db":
        init_db()
        print("数据库已初始化：表结构/轻量迁移已完成，内置管理员和默认 Prompt 已就绪。")
    elif args.command == "reset-admin":
        reset_admin()
        print("内置管理员已重置或创建。")
    elif args.command == "seed-algorithms":
        chunks_count = seed_algorithms()
        print(f"内置算法知识已写入 SQLite 并完成 ChromaDB 向量索引，共写入 {chunks_count} 个分块。可重复执行，不会重复创建文档。")


if __name__ == "__main__":
    main()
