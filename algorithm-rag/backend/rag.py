import re
import string
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from config import get_settings
from database import ChatLog, Document, DocumentStatus, Prompt, User
from prompts import DEFAULT_PROMPT
from schemas import SourceOut
from vector_store import search_ready_documents

ALGORITHM_KEYWORDS = {
    "algorithm", "data structure", "complexity", "leetcode", "sort", "search", "graph", "tree",
    "dynamic programming", "dp", "greedy", "binary", "stack", "queue", "heap", "hash", "bfs", "dfs",
    "算法", "数据结构", "复杂度", "刷题", "排序", "查找", "图", "树", "动态规划", "贪心", "二分",
    "栈", "队列", "堆", "哈希", "递归", "回溯", "滑动窗口", "双指针",
}

def get_active_prompt(db: Session) -> str:
    prompt = db.query(Prompt).filter(Prompt.is_active.is_(True)).order_by(Prompt.id.desc()).first()
    return prompt.content if prompt else DEFAULT_PROMPT


def lexical_terms(text: str) -> set[str]:
    ascii_terms = {term for term in re.findall(r"[a-z0-9_]+", text.lower()) if len(term) > 1}
    cjk_terms: set[str] = set()
    for sequence in re.findall(r"[一-鿿]+", text):
        if len(sequence) > 1:
            cjk_terms.add(sequence)
            cjk_terms.update(sequence[index : index + 2] for index in range(len(sequence) - 1))
    common_terms = {"怎么", "什么", "一个", "这个", "那个", "可以", "如何"}
    return (ascii_terms | cjk_terms) - common_terms


def token_overlap_score(query: str, text: str) -> int:
    return len(lexical_terms(query) & lexical_terms(text))


def has_lexical_relevance(query: str, matches: list[dict[str, Any]]) -> bool:
    query_terms = lexical_terms(query)
    if not query_terms:
        return False
    context_terms: set[str] = set()
    for match in matches:
        context_terms.update(lexical_terms(match["text"]))
    if query_terms & context_terms:
        return True
    contains_ascii = bool(set(query.lower()) & set(string.ascii_letters))
    return contains_ascii and any(keyword in query.lower() for keyword in ALGORITHM_KEYWORDS)


def rerank(query: str, matches: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    ranked = []
    for index, match in enumerate(matches):
        overlap = token_overlap_score(query, match["text"])
        vector_score = 1 / (1 + float(match.get("distance") or 0))
        ranked.append((overlap * 2 + vector_score - index * 0.01, match))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [match for _, match in ranked[:limit]]


def build_sources(matches: list[dict[str, Any]]) -> list[SourceOut]:
    sources: list[SourceOut] = []
    for match in matches:
        metadata = match["metadata"] or {}
        sources.append(
            SourceOut(
                document_id=int(metadata.get("document_id")),
                document_name=str(metadata.get("document_name", "unknown")),
                location=str(metadata.get("location", "unknown")),
                preview=str(metadata.get("preview", match["text"][:260])),
                score=None if match.get("distance") is None else float(match["distance"]),
            )
        )
    return sources


def call_llm(question: str, context: str, prompt: str) -> str:
    settings = get_settings()
    if not settings.openai_api_key or not settings.openai_base_url:
        raise RuntimeError("OPENAI_API_KEY and OPENAI_BASE_URL must be configured in .env")
    try:
        from openai import OpenAI
    except ModuleNotFoundError as exc:
        if exc.name == "openai":
            raise RuntimeError("缺少 OpenAI 依赖包，请在后端目录安装依赖：python -m pip install -r requirements.txt") from exc
        raise
    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    response = client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"知识库片段：\n{context}\n\n用户问题：{question}"},
        ],
        temperature=0.2,
    )
    return response.choices[0].message.content or "未能生成回答。"


def answer_question(db: Session, user: User, question: str) -> tuple[str, list[SourceOut], bool]:
    settings = get_settings()
    if len(question) > settings.max_chat_message_chars:
        raise HTTPException(
            status_code=413,
            detail=f"消息长度不能超过 {settings.max_chat_message_chars} 个字符",
        )

    ready_ids = [row.id for row in db.query(Document.id).filter(Document.status == DocumentStatus.ready).all()]
    if not ready_ids:
        answer = "当前算法知识库还没有可查询资料，请先让管理员上传或审核算法资料。"
        log = ChatLog(user_id=user.id, question=question, answer=answer, sources=[], blocked=True)
        db.add(log)
        db.flush()
        return answer, [], True

    matches = search_ready_documents(question, ready_ids, settings.rag_top_k)
    ranked = rerank(question, matches, settings.rerank_top_k)
    if not ranked or not has_lexical_relevance(question, ranked):
        answer = "我在当前算法知识库中没有找到相关内容，请先让管理员上传或审核相关算法资料。"
        log = ChatLog(user_id=user.id, question=question, answer=answer, sources=[], blocked=True)
        db.add(log)
        db.flush()
        return answer, [], True

    prompt = get_active_prompt(db)
    sources = build_sources(ranked)
    context = "\n\n".join(
        f"[{idx}] {source.document_name} / {source.location}\n{match['text']}"
        for idx, (source, match) in enumerate(zip(sources, ranked), start=1)
    )
    answer = call_llm(question, context, prompt)
    source_dicts = [source.model_dump() for source in sources]
    log = ChatLog(user_id=user.id, question=question, answer=answer, sources=source_dicts, blocked=False)
    db.add(log)
    db.flush()
    return answer, sources, False
