from dataclasses import dataclass
import re


@dataclass
class Chunk:
    text: str
    location: str


def chunk_text(text: str, location_prefix: str, size: int = 900, overlap: int = 150) -> list[Chunk]:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []
    chunks: list[Chunk] = []
    start = 0
    index = 1
    while start < len(cleaned):
        end = min(start + size, len(cleaned))
        chunks.append(Chunk(text=cleaned[start:end], location=f"{location_prefix} · 分块 {index}"))
        if end == len(cleaned):
            break
        start = max(0, end - overlap)
        index += 1
    return chunks


def extract_pdf_chunks(path: str) -> list[Chunk]:
    try:
        from pypdf import PdfReader
    except ModuleNotFoundError as exc:
        if exc.name == "pypdf":
            raise RuntimeError("缺少 PDF 解析依赖 pypdf，请在后端目录执行：python -m pip install -r requirements.txt") from exc
        raise

    reader = PdfReader(path)
    chunks: list[Chunk] = []
    for page_index, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        chunks.extend(chunk_text(page_text, f"第 {page_index} 页"))
    return chunks


def extract_markdown_chunks(path: str) -> list[Chunk]:
    with open(path, "r", encoding="utf-8") as file:
        content = file.read()
    sections = re.split(r"(?=^#{1,6}\s+)", content, flags=re.MULTILINE)
    chunks: list[Chunk] = []
    paragraph_index = 1
    for section in sections:
        section = section.strip()
        if not section:
            continue
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", section, flags=re.MULTILINE)
        heading = heading_match.group(2).strip() if heading_match else f"第 {paragraph_index} 节"
        section_chunks = chunk_text(section, heading)
        chunks.extend(section_chunks)
        paragraph_index += 1
    return chunks


def extract_chunks(path: str, filename: str) -> list[Chunk]:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return extract_pdf_chunks(path)
    if lower.endswith(".md"):
        return extract_markdown_chunks(path)
    raise ValueError("仅支持 PDF 和 Markdown 文件")
