from typing import Any

import chromadb

from config import get_settings
from embedding import embed_texts

COLLECTION_NAME = "algorithm_documents"


def get_collection():
    settings = get_settings()
    client = chromadb.PersistentClient(path=settings.chroma_dir)
    return client.get_or_create_collection(name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"})


def replace_document_chunks(document_id: int, filename: str, chunks: list[dict[str, str]]) -> None:
    collection = get_collection()
    existing = collection.get(where={"document_id": document_id})
    existing_ids = existing.get("ids", [])
    if existing_ids:
        collection.delete(ids=existing_ids)
    if not chunks:
        return
    texts = [chunk["text"] for chunk in chunks]
    vectors = embed_texts(texts)
    ids = [f"doc-{document_id}-chunk-{index}" for index in range(len(chunks))]
    metadatas = [
        {
            "document_id": document_id,
            "document_name": filename,
            "location": chunk["location"],
            "preview": chunk["text"][:260],
        }
        for chunk in chunks
    ]
    collection.add(ids=ids, documents=texts, embeddings=vectors, metadatas=metadatas)


def search_ready_documents(query: str, ready_document_ids: list[int], top_k: int) -> list[dict[str, Any]]:
    if not ready_document_ids:
        return []
    collection = get_collection()
    query_vector = embed_texts([query])[0]
    results = collection.query(
        query_embeddings=[query_vector],
        n_results=top_k,
        where={"document_id": {"$in": ready_document_ids}},
        include=["documents", "metadatas", "distances"],
    )
    matches: list[dict[str, Any]] = []
    ids = results.get("ids", [[]])[0]
    docs = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]
    for chunk_id, text, metadata, distance in zip(ids, docs, metadatas, distances):
        matches.append({"id": chunk_id, "text": text, "metadata": metadata, "distance": distance})
    return matches
