from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, Enum as SqlEnum, ForeignKey, Integer, JSON, String, Text, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from config import get_settings

settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class UserRole(str, Enum):
    admin = "admin"
    people = "people"


class RegistrationStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class DocumentStatus(str, Enum):
    pending_approval = "pending_approval"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class DocumentKind(str, Enum):
    pdf = "pdf"
    markdown = "markdown"


class DocumentVisibility(str, Enum):
    private = "private"
    shared = "shared"
    system = "system"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(80), index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(SqlEnum(UserRole), default=UserRole.people)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    documents: Mapped[list["Document"]] = relationship(back_populates="uploaded_by_user", foreign_keys="Document.uploaded_by")
    conversations: Mapped[list["Conversation"]] = relationship(back_populates="user")


class RegistrationRequest(Base):
    __tablename__ = "registration_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    username: Mapped[str] = mapped_column(String(80), index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[RegistrationStatus] = mapped_column(SqlEnum(RegistrationStatus), default=RegistrationStatus.pending, index=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewed_by])


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(500))
    kind: Mapped[DocumentKind] = mapped_column(SqlEnum(DocumentKind))
    visibility: Mapped[DocumentVisibility] = mapped_column(SqlEnum(DocumentVisibility), default=DocumentVisibility.private, index=True)
    status: Mapped[DocumentStatus] = mapped_column(SqlEnum(DocumentStatus), default=DocumentStatus.pending_approval)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    uploaded_by_user: Mapped[User] = relationship(foreign_keys=[uploaded_by], back_populates="documents")
    approved_by_user: Mapped[User | None] = relationship(foreign_keys=[approved_by])


class AlgorithmEntry(Base):
    __tablename__ = "algorithm_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(80), index=True)
    difficulty: Mapped[str] = mapped_column(String(40), default="基础")
    tags: Mapped[str] = mapped_column(String(500), default="")
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(80), default="新对话")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    user: Mapped[User] = relationship(back_populates="conversations")
    messages: Mapped[list["ConversationMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ConversationMessage.created_at",
    )


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), index=True)
    role: Mapped[str] = mapped_column(String(20), index=True)
    content: Mapped[str] = mapped_column(Text)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class Prompt(Base):
    __tablename__ = "prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="default")
    content: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ChatLog(Base):
    __tablename__ = "chat_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped[User] = relationship()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _sqlite_table_columns(table_name: str) -> set[str]:
    with engine.connect() as connection:
        return {row[1] for row in connection.execute(text(f"PRAGMA table_info({table_name})"))}


def _sqlite_table_names() -> set[str]:
    with engine.connect() as connection:
        return {row[0] for row in connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}


def _sqlite_rebuild_legacy_users_table() -> None:
    """Drop the legacy username UNIQUE constraint while preserving IDs and history."""
    if "users" not in _sqlite_table_names():
        return
    columns = _sqlite_table_columns("users")
    required = {"id", "username", "password_hash", "role", "is_active", "created_at"}
    if not required.issubset(columns):
        return

    with engine.begin() as connection:
        indexes = connection.execute(text("PRAGMA index_list(users)")).fetchall()
        has_legacy_unique_username = False
        for index in indexes:
            index_name = index[1]
            is_unique = bool(index[2])
            if not is_unique:
                continue
            indexed_columns = [row[2] for row in connection.execute(text(f"PRAGMA index_info({index_name})"))]
            if indexed_columns == ["username"]:
                has_legacy_unique_username = True
                break
        if not has_legacy_unique_username:
            return

        connection.execute(text("PRAGMA foreign_keys=OFF"))
        connection.execute(
            text(
                """
                CREATE TABLE users_new (
                    id INTEGER NOT NULL PRIMARY KEY,
                    username VARCHAR(80) NOT NULL,
                    email VARCHAR(255),
                    password_hash VARCHAR(255) NOT NULL,
                    role VARCHAR(6) NOT NULL,
                    is_active BOOLEAN NOT NULL,
                    is_builtin BOOLEAN NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL,
                    deleted_at DATETIME
                )
                """
            )
        )
        email_expr = "email" if "email" in columns else "NULL"
        is_builtin_expr = "is_builtin" if "is_builtin" in columns else "0"
        deleted_at_expr = "deleted_at" if "deleted_at" in columns else "NULL"
        connection.execute(
            text(
                f"""
                INSERT INTO users_new (id, username, email, password_hash, role, is_active, is_builtin, created_at, deleted_at)
                SELECT id, username, {email_expr}, password_hash, role, is_active, {is_builtin_expr}, created_at, {deleted_at_expr}
                FROM users
                """
            )
        )
        connection.execute(text("DROP TABLE users"))
        connection.execute(text("ALTER TABLE users_new RENAME TO users"))
        connection.execute(text("PRAGMA foreign_keys=ON"))


def _sqlite_lightweight_migrations() -> None:
    if not settings.database_url.startswith("sqlite"):
        return

    _sqlite_rebuild_legacy_users_table()
    columns = _sqlite_table_columns("users")
    with engine.begin() as connection:
        if "email" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255)"))
        if "is_builtin" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN is_builtin BOOLEAN NOT NULL DEFAULT 0"))
        if "deleted_at" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN deleted_at DATETIME"))

        document_columns = _sqlite_table_columns("documents") if "documents" in _sqlite_table_names() else set()
        if "documents" in _sqlite_table_names() and "visibility" not in document_columns:
            connection.execute(text("ALTER TABLE documents ADD COLUMN visibility VARCHAR(7) NOT NULL DEFAULT 'private'"))
        if "documents" in _sqlite_table_names():
            connection.execute(
                text(
                    """
                    UPDATE documents
                    SET visibility = CASE
                        WHEN stored_path = 'sqlite://algorithm_entries/default' THEN 'system'
                        WHEN visibility = 'system' THEN 'system'
                        WHEN uploaded_by IN (SELECT id FROM users WHERE role = 'admin') THEN 'shared'
                        ELSE visibility
                    END
                    """
                )
            )

        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_users_id ON users (id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_users_username ON users (username)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_users_email ON users (email)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_algorithm_entries_id ON algorithm_entries (id)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_algorithm_entries_title ON algorithm_entries (title)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_algorithm_entries_category ON algorithm_entries (category)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_documents_visibility ON documents (visibility)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_id ON conversations (id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_user_id ON conversations (user_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_created_at ON conversations (created_at)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_updated_at ON conversations (updated_at)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_deleted_at ON conversations (deleted_at)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversation_messages_id ON conversation_messages (id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversation_messages_conversation_id ON conversation_messages (conversation_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversation_messages_role ON conversation_messages (role)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_conversation_messages_created_at ON conversation_messages (created_at)"))
        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ix_users_active_username_unique
                ON users (username)
                WHERE is_active = 1 AND deleted_at IS NULL
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ix_users_active_email_unique
                ON users (email)
                WHERE email IS NOT NULL AND is_active = 1 AND deleted_at IS NULL
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ix_registration_requests_open_username_unique
                ON registration_requests (username)
                WHERE status IN ('pending', 'approved')
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ix_registration_requests_open_email_unique
                ON registration_requests (email)
                WHERE status IN ('pending', 'approved')
                """
            )
        )


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)
    _sqlite_lightweight_migrations()
