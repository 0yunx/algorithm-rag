from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from auth import authenticate_user, create_access_token, get_current_user, hash_password, require_admin
from config import get_settings
from database import (
    ChatLog,
    Conversation,
    ConversationMessage,
    Document,
    DocumentKind,
    DocumentStatus,
    DocumentVisibility,
    Prompt,
    RegistrationRequest,
    RegistrationStatus,
    SessionLocal,
    User,
    UserRole,
    get_db,
)
from document_processor import extract_chunks
from prompts import DEFAULT_PROMPT
from rag import answer_question
from schemas import (
    ChatLogOut,
    ChatRequest,
    ChatResponse,
    ConversationMessageOut,
    ConversationOut,
    ConversationSearchResult,
    ConversationSummary,
    CreateUserRequest,
    DocumentDetailOut,
    DocumentOut,
    LoginRequest,
    PromptOut,
    PromptUpdateRequest,
    RegisterRequest,
    RegisterResponse,
    RegistrationRequestOut,
    ResetPasswordRequest,
    TokenResponse,
    UserOut,
)
from seed import ALGORITHM_KNOWLEDGE_DOCUMENT_PATH, algorithm_entry_chunks, ensure_default_algorithm_entries, init_db
from vector_store import replace_document_chunks

settings = get_settings()
app = FastAPI(title="Algorithm RAG API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def display_username(user: User | None) -> str:
    if not user:
        return "未知用户"
    markers: list[str] = []
    if not user.is_active:
        markers.append("停用")
    if user.deleted_at is not None:
        markers.append("已删除")
    if not markers:
        return user.username
    return f"{user.username}（{'/'.join(markers)}）"


def conversation_title(message: str) -> str:
    title = "".join(message.split())[:10]
    return title or "新对话"


def message_out(message: ConversationMessage) -> ConversationMessageOut:
    return ConversationMessageOut(
        id=message.id,
        role=message.role,
        content=message.content,
        sources=message.sources or [],
        blocked=message.blocked,
        created_at=message.created_at,
    )


def conversation_out(conversation: Conversation, include_messages: bool = True) -> ConversationOut:
    return ConversationOut(
        id=conversation.id,
        user_id=conversation.user_id,
        username=display_username(conversation.user) if conversation.user else None,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        deleted_at=conversation.deleted_at,
        messages=[message_out(message) for message in conversation.messages] if include_messages else [],
    )


def conversation_summary(conversation: Conversation, message_count: int = 0, last_preview: str | None = None) -> ConversationSummary:
    return ConversationSummary(
        id=conversation.id,
        user_id=conversation.user_id,
        username=display_username(conversation.user) if conversation.user else None,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        deleted_at=conversation.deleted_at,
        message_count=message_count,
        last_message_preview=last_preview,
    )


def search_snippet(content: str, query: str, radius: int = 36) -> str:
    lower_content = content.lower()
    lower_query = query.lower()
    index = lower_content.find(lower_query)
    if index < 0:
        return content[: radius * 2]
    start = max(0, index - radius)
    end = min(len(content), index + len(query) + radius)
    prefix = "..." if start else ""
    suffix = "..." if end < len(content) else ""
    return f"{prefix}{content[start:end]}{suffix}"


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def active_user_conflict(db: Session, username: str, email: str | None = None) -> User | None:
    filters = [User.username == username]
    if email:
        filters.append(User.email == email)
    return db.query(User).filter(User.is_active.is_(True), User.deleted_at.is_(None), or_(*filters)).first()


def open_registration_conflict(db: Session, username: str, email: str, exclude_id: int | None = None) -> RegistrationRequest | None:
    query = db.query(RegistrationRequest).filter(
        RegistrationRequest.status.in_([RegistrationStatus.pending, RegistrationStatus.approved]),
        or_(RegistrationRequest.username == username, RegistrationRequest.email == email),
    )
    if exclude_id is not None:
        query = query.filter(RegistrationRequest.id != exclude_id)
    return query.first()


def ensure_registration_available(db: Session, username: str, email: str, exclude_request_id: int | None = None) -> None:
    if active_user_conflict(db, username, email):
        raise HTTPException(status_code=409, detail="用户名或邮箱已被使用")
    if open_registration_conflict(db, username, email, exclude_request_id):
        raise HTTPException(status_code=409, detail="已有待审批或已通过的注册申请使用该用户名或邮箱")


def ensure_user_create_available(db: Session, username: str, email: str | None) -> None:
    if active_user_conflict(db, username, email):
        raise HTTPException(status_code=409, detail="用户名或邮箱已被使用")
    if email and open_registration_conflict(db, username, email):
        raise HTTPException(status_code=409, detail="已有待审批或已通过的注册申请使用该用户名或邮箱")
    if not email:
        request = (
            db.query(RegistrationRequest)
            .filter(
                RegistrationRequest.status.in_([RegistrationStatus.pending, RegistrationStatus.approved]),
                RegistrationRequest.username == username,
            )
            .first()
        )
        if request:
            raise HTTPException(status_code=409, detail="已有待审批或已通过的注册申请使用该用户名")


def document_kind(filename: str) -> DocumentKind:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return DocumentKind.pdf
    if lower.endswith(".md"):
        return DocumentKind.markdown
    raise HTTPException(status_code=400, detail="仅支持 .pdf 和 .md 文件")


def visible_document_filter(current_user: User):
    if current_user.role == UserRole.admin:
        return True
    return (
        (Document.uploaded_by == current_user.id)
        | (Document.visibility == DocumentVisibility.system)
        | ((Document.visibility == DocumentVisibility.shared) & (Document.status == DocumentStatus.ready))
    )


def normalize_upload_visibility(value: str | None, current_user: User) -> DocumentVisibility:
    if current_user.role == UserRole.admin:
        return DocumentVisibility.shared
    if value is None:
        return DocumentVisibility.private
    try:
        visibility = DocumentVisibility(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="visibility 只能是 private 或 shared") from exc
    if visibility not in {DocumentVisibility.private, DocumentVisibility.shared}:
        raise HTTPException(status_code=400, detail="普通用户只能选择 private 或 shared")
    return visibility


def get_visible_document_or_404(db: Session, document_id: int, current_user: User) -> Document:
    query = db.query(Document).filter(Document.id == document_id)
    if current_user.role != UserRole.admin:
        query = query.filter(visible_document_filter(current_user))
    document = query.first()
    if not document:
        raise HTTPException(status_code=404, detail="文档不存在")
    return document


def document_markdown_content(document: Document) -> str:
    if document.stored_path == ALGORITHM_KNOWLEDGE_DOCUMENT_PATH:
        db = SessionLocal()
        try:
            entries = ensure_default_algorithm_entries(db)
            return "\n\n".join(
                [
                    f"# {entry.title}\n\n"
                    f"**分类：** {entry.category}\n\n"
                    f"**难度：** {entry.difficulty}\n\n"
                    f"**标签：** {entry.tags}\n\n"
                    f"{entry.content.strip()}"
                    for entry in entries
                ]
            )
        finally:
            db.close()
    path = Path(document.stored_path)
    if document.kind == DocumentKind.markdown:
        try:
            return path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return path.read_text(encoding="utf-8", errors="replace")
    chunks = extract_chunks(document.stored_path, document.filename)
    if not chunks:
        return ""
    return "\n\n".join(f"## {chunk.location}\n\n{chunk.text}" for chunk in chunks)


def index_document(document_id: int) -> None:
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if not document:
            return
        document.status = DocumentStatus.processing
        document.error_message = None
        db.commit()
        if document.stored_path == ALGORITHM_KNOWLEDGE_DOCUMENT_PATH:
            chunks = algorithm_entry_chunks(ensure_default_algorithm_entries(db))
        else:
            chunks = extract_chunks(document.stored_path, document.filename)
        if not chunks:
            raise ValueError("未能从该文档中提取文本内容")
        replace_document_chunks(
            document.id,
            document.filename,
            [{"text": chunk.text, "location": chunk.location} for chunk in chunks],
        )
        document.status = DocumentStatus.ready
        document.error_message = None
        db.commit()
    except Exception as exc:
        document = db.get(Document, document_id)
        if document:
            document.status = DocumentStatus.failed
            document.error_message = str(exc)
            db.commit()
    finally:
        db.close()


@app.post("/register", response_model=RegisterResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> RegisterResponse:
    ensure_registration_available(db, payload.username, payload.email)
    request = RegistrationRequest(
        email=payload.email,
        username=payload.username,
        password_hash=hash_password(payload.password),
        reason=payload.reason,
        status=RegistrationStatus.pending,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return RegisterResponse(id=request.id, status=request.status, message="注册申请已提交，请等待管理员审批。")


@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    username = payload.username.strip()
    if not username or not payload.password:
        raise HTTPException(status_code=400, detail="请输入用户名和密码")
    user = authenticate_user(db, username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    return TokenResponse(access_token=create_access_token(str(user.id)), user=UserOut.model_validate(user))


@app.get("/auth/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)


@app.get("/documents", response_model=list[DocumentOut])
def list_documents(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[DocumentOut]:
    query = db.query(Document).order_by(Document.created_at.desc())
    if current_user.role != UserRole.admin:
        query = query.filter(visible_document_filter(current_user))
    return [DocumentOut.model_validate(document) for document in query.all()]


@app.get("/documents/{document_id}", response_model=DocumentDetailOut)
def get_document(document_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> DocumentDetailOut:
    document = get_visible_document_or_404(db, document_id, current_user)
    try:
        content = document_markdown_content(document)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="文档文件不存在") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"读取文档失败：{exc}") from exc
    data = DocumentOut.model_validate(document).model_dump()
    return DocumentDetailOut(**data, content=content)


@app.post("/documents/upload", response_model=DocumentOut)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    visibility: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentOut:
    kind = document_kind(file.filename or "")
    document_visibility = normalize_upload_visibility(visibility, current_user)
    max_bytes = settings.max_upload_mb * 1024 * 1024
    upload_root = Path(settings.upload_dir)
    upload_root.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4().hex}-{Path(file.filename or 'upload').name}"
    stored_path = upload_root / stored_name
    size = 0
    with stored_path.open("wb") as output:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                output.close()
                stored_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="文件过大")
            output.write(chunk)
    status = DocumentStatus.processing if current_user.role == UserRole.admin else DocumentStatus.pending_approval
    document = Document(
        filename=file.filename or stored_name,
        stored_path=str(stored_path),
        kind=kind,
        visibility=document_visibility,
        status=status,
        uploaded_by=current_user.id,
        approved_by=current_user.id if current_user.role == UserRole.admin else None,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    if current_user.role == UserRole.admin:
        background_tasks.add_task(index_document, document.id)
    return DocumentOut.model_validate(document)


@app.post("/admin/documents/upload", response_model=DocumentOut)
def admin_upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> DocumentOut:
    return upload_document(background_tasks=background_tasks, file=file, visibility=None, current_user=admin, db=db)


@app.post("/upload", response_model=DocumentOut)
def legacy_upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    visibility: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentOut:
    return upload_document(background_tasks=background_tasks, file=file, visibility=visibility, current_user=current_user, db=db)


@app.post("/documents/{document_id}/approve", response_model=DocumentOut)
def approve_document(
    document_id: int,
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> DocumentOut:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档不存在")
    if document.status != DocumentStatus.pending_approval:
        raise HTTPException(status_code=400, detail="只能审核待处理文档")
    document.status = DocumentStatus.processing
    document.approved_by = admin.id
    document.error_message = None
    db.commit()
    db.refresh(document)
    background_tasks.add_task(index_document, document.id)
    return DocumentOut.model_validate(document)


@app.post("/documents/{document_id}/retry", response_model=DocumentOut)
def retry_document(
    document_id: int,
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> DocumentOut:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档不存在")
    document.status = DocumentStatus.processing
    document.approved_by = admin.id
    document.error_message = None
    db.commit()
    db.refresh(document)
    background_tasks.add_task(index_document, document.id)
    return DocumentOut.model_validate(document)


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ChatResponse:
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="消息不能为空")
    conversation: Conversation | None = None
    if payload.conversation_id is not None:
        conversation = (
            db.query(Conversation)
            .filter(
                Conversation.id == payload.conversation_id,
                Conversation.user_id == current_user.id,
                Conversation.deleted_at.is_(None),
            )
            .first()
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
    else:
        conversation = Conversation(user_id=current_user.id, title=conversation_title(message))
        db.add(conversation)
        db.flush()

    user_message = ConversationMessage(conversation_id=conversation.id, role="user", content=message)
    db.add(user_message)
    answer, sources, blocked = answer_question(db, current_user, message)
    source_dicts = [source.model_dump() for source in sources]
    assistant_message = ConversationMessage(
        conversation_id=conversation.id,
        role="assistant",
        content=answer,
        sources=source_dicts,
        blocked=blocked,
    )
    db.add(assistant_message)
    conversation.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(conversation)
    return ChatResponse(answer=answer, sources=sources, blocked=blocked, conversation_id=conversation.id, title=conversation.title)


@app.get("/conversations", response_model=list[ConversationSummary])
def list_conversations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ConversationSummary]:
    conversations = (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id, Conversation.deleted_at.is_(None))
        .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
        .all()
    )
    result: list[ConversationSummary] = []
    for conversation in conversations:
        count = db.query(func.count(ConversationMessage.id)).filter(ConversationMessage.conversation_id == conversation.id).scalar() or 0
        last_message = (
            db.query(ConversationMessage)
            .filter(ConversationMessage.conversation_id == conversation.id)
            .order_by(ConversationMessage.created_at.desc(), ConversationMessage.id.desc())
            .first()
        )
        result.append(conversation_summary(conversation, int(count), last_message.content[:80] if last_message else None))
    return result


@app.post("/conversations", response_model=ConversationOut)
def create_conversation(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ConversationOut:
    conversation = Conversation(user_id=current_user.id, title="新对话")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation_out(conversation)


@app.get("/conversations/search", response_model=list[ConversationSearchResult])
def search_conversations(q: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ConversationSearchResult]:
    query = q.strip()
    if not query:
        return []
    pattern = f"%{query}%"
    rows = (
        db.query(Conversation, ConversationMessage)
        .join(ConversationMessage, ConversationMessage.conversation_id == Conversation.id)
        .filter(
            Conversation.user_id == current_user.id,
            Conversation.deleted_at.is_(None),
            or_(Conversation.title.ilike(pattern), ConversationMessage.content.ilike(pattern)),
        )
        .order_by(Conversation.updated_at.desc(), ConversationMessage.created_at.asc())
        .limit(50)
        .all()
    )
    return [
        ConversationSearchResult(
            conversation_id=conversation.id,
            message_id=message.id,
            title=conversation.title,
            user_id=conversation.user_id,
            username=None,
            role=message.role,
            snippet=search_snippet(message.content, query),
            created_at=message.created_at,
        )
        for conversation, message in rows
    ]


@app.get("/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(conversation_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ConversationOut:
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == current_user.id, Conversation.deleted_at.is_(None))
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conversation_out(conversation)


@app.post("/conversations/{conversation_id}/delete", response_model=ConversationOut)
@app.delete("/conversations/{conversation_id}", response_model=ConversationOut)
def delete_conversation(conversation_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ConversationOut:
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == current_user.id, Conversation.deleted_at.is_(None))
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    conversation.deleted_at = datetime.utcnow()
    conversation.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(conversation)
    return conversation_out(conversation)


@app.get("/admin/conversations", response_model=list[ConversationSummary])
def admin_list_conversations(
    q: str | None = None,
    user_id: int | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[ConversationSummary]:
    query = db.query(Conversation).join(User).filter(Conversation.deleted_at.is_(None))
    if user_id is not None:
        query = query.filter(Conversation.user_id == user_id)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.filter(or_(Conversation.title.ilike(pattern), User.username.ilike(pattern), User.email.ilike(pattern)))
    conversations = query.order_by(Conversation.updated_at.desc(), Conversation.id.desc()).limit(300).all()
    result: list[ConversationSummary] = []
    for conversation in conversations:
        count = db.query(func.count(ConversationMessage.id)).filter(ConversationMessage.conversation_id == conversation.id).scalar() or 0
        last_message = (
            db.query(ConversationMessage)
            .filter(ConversationMessage.conversation_id == conversation.id)
            .order_by(ConversationMessage.created_at.desc(), ConversationMessage.id.desc())
            .first()
        )
        result.append(conversation_summary(conversation, int(count), last_message.content[:80] if last_message else None))
    return result


@app.get("/admin/conversations/search", response_model=list[ConversationSearchResult])
def admin_search_conversations(
    q: str,
    user_id: int | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[ConversationSearchResult]:
    query = q.strip()
    if not query:
        return []
    pattern = f"%{query}%"
    rows_query = (
        db.query(Conversation, ConversationMessage)
        .join(User, User.id == Conversation.user_id)
        .join(ConversationMessage, ConversationMessage.conversation_id == Conversation.id)
        .filter(
            Conversation.deleted_at.is_(None),
            or_(
                Conversation.title.ilike(pattern),
                ConversationMessage.content.ilike(pattern),
                User.username.ilike(pattern),
                User.email.ilike(pattern),
            ),
        )
    )
    if user_id is not None:
        rows_query = rows_query.filter(Conversation.user_id == user_id)
    rows = rows_query.order_by(Conversation.updated_at.desc(), ConversationMessage.created_at.asc()).limit(100).all()
    return [
        ConversationSearchResult(
            conversation_id=conversation.id,
            message_id=message.id,
            title=conversation.title,
            user_id=conversation.user_id,
            username=display_username(conversation.user),
            role=message.role,
            snippet=search_snippet(message.content, query),
            created_at=message.created_at,
        )
        for conversation, message in rows
    ]


@app.get("/admin/conversations/{conversation_id}", response_model=ConversationOut)
def admin_get_conversation(conversation_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> ConversationOut:
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id, Conversation.deleted_at.is_(None)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conversation_out(conversation)


@app.post("/admin/conversations/{conversation_id}/delete", response_model=ConversationOut)
@app.delete("/admin/conversations/{conversation_id}", response_model=ConversationOut)
def admin_delete_conversation(conversation_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> ConversationOut:
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id, Conversation.deleted_at.is_(None)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    conversation.deleted_at = datetime.utcnow()
    conversation.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(conversation)
    return conversation_out(conversation)


@app.get("/admin/registration-requests", response_model=list[RegistrationRequestOut])
def registration_requests(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[RegistrationRequestOut]:
    requests = db.query(RegistrationRequest).order_by(RegistrationRequest.created_at.desc()).all()
    return [RegistrationRequestOut.model_validate(request) for request in requests]


@app.post("/admin/registration-requests/{request_id}/approve", response_model=RegistrationRequestOut)
def approve_registration_request(
    request_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> RegistrationRequestOut:
    request = db.get(RegistrationRequest, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="注册申请不存在")
    if request.status != RegistrationStatus.pending:
        raise HTTPException(status_code=400, detail="只能通过待审批注册申请")
    ensure_registration_available(db, request.username, request.email, exclude_request_id=request.id)
    user = User(
        username=request.username,
        email=request.email,
        password_hash=request.password_hash,
        role=UserRole.people,
        is_active=True,
        is_builtin=False,
    )
    db.add(user)
    request.status = RegistrationStatus.approved
    request.reviewed_by = admin.id
    request.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(request)
    return RegistrationRequestOut.model_validate(request)


@app.post("/admin/registration-requests/{request_id}/reject", response_model=RegistrationRequestOut)
def reject_registration_request(
    request_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> RegistrationRequestOut:
    request = db.get(RegistrationRequest, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="注册申请不存在")
    if request.status != RegistrationStatus.pending:
        raise HTTPException(status_code=400, detail="只能拒绝待审批注册申请")
    request.status = RegistrationStatus.rejected
    request.reviewed_by = admin.id
    request.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(request)
    return RegistrationRequestOut.model_validate(request)


@app.get("/admin/users", response_model=list[UserOut])
def admin_users(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[UserOut]:
    return [UserOut.model_validate(user) for user in db.query(User).order_by(User.created_at.desc()).all()]


@app.post("/admin/users", response_model=UserOut)
def create_user(payload: CreateUserRequest, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> UserOut:
    ensure_user_create_available(db, payload.username, payload.email)
    user = User(username=payload.username, email=payload.email, password_hash=hash_password(payload.password), role=payload.role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@app.post("/admin/users/{user_id}/reset-password", response_model=UserOut)
def reset_user_password(
    user_id: int,
    payload: ResetPasswordRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=400, detail="不能为已删除或已停用用户重置密码")
    user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@app.post("/admin/users/{user_id}/delete", response_model=UserOut)
def soft_delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    if user.is_builtin:
        raise HTTPException(status_code=400, detail="内置管理员不能删除")
    if not user.is_active or user.deleted_at is not None:
        return UserOut.model_validate(user)
    active_admin_count = db.query(User).filter(User.role == UserRole.admin, User.is_active.is_(True), User.deleted_at.is_(None)).count()
    if active_admin_count <= 0:
        raise HTTPException(status_code=400, detail="系统必须至少保留一个启用的管理员")
    if user.role == UserRole.admin and active_admin_count <= 1:
        raise HTTPException(status_code=400, detail="不能删除最后一个启用的管理员")
    user.is_active = False
    user.deleted_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@app.get("/admin/prompts/active", response_model=PromptOut)
def get_active_prompt(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> PromptOut:
    prompt = db.query(Prompt).filter(Prompt.is_active.is_(True)).order_by(Prompt.id.desc()).first()
    if not prompt:
        prompt = Prompt(name="default", content=DEFAULT_PROMPT, is_active=True)
        db.add(prompt)
        db.commit()
        db.refresh(prompt)
    return PromptOut.model_validate(prompt)


@app.put("/admin/prompts/active", response_model=PromptOut)
def update_active_prompt(payload: PromptUpdateRequest, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> PromptOut:
    db.query(Prompt).update({Prompt.is_active: False})
    prompt = Prompt(name="custom", content=payload.content, is_active=True)
    db.add(prompt)
    db.commit()
    db.refresh(prompt)
    return PromptOut.model_validate(prompt)


@app.get("/admin/chat-logs", response_model=list[ChatLogOut])
def chat_logs(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[ChatLogOut]:
    logs = db.query(ChatLog).join(User).order_by(ChatLog.created_at.desc()).limit(200).all()
    return [
        ChatLogOut(
            id=log.id,
            user_id=log.user_id,
            username=display_username(log.user),
            email=log.user.email if log.user else None,
            question=log.question,
            answer=log.answer,
            sources=log.sources or [],
            blocked=log.blocked,
            created_at=log.created_at,
        )
        for log in logs
    ]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
