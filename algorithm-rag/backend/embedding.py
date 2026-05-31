from functools import lru_cache
import os

from config import get_settings


class EmbeddingModel:
    def __init__(self) -> None:
        settings = get_settings()
        os.environ["HF_HOME"] = settings.embedding_cache_dir
        os.environ["SENTENCE_TRANSFORMERS_HOME"] = settings.embedding_cache_dir
        os.environ["TRANSFORMERS_CACHE"] = settings.embedding_cache_dir
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError("sentence-transformers is required for local BGE-M3 embeddings") from exc
        self.model = SentenceTransformer(
            settings.embedding_model,
            device=settings.embedding_device,
            cache_folder=settings.embedding_cache_dir,
        )

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors = self.model.encode(texts, normalize_embeddings=True)
        return [vector.tolist() for vector in vectors]


@lru_cache
def get_embedding_model() -> EmbeddingModel:
    return EmbeddingModel()


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    return get_embedding_model().embed(texts)
