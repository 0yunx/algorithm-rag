from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import authenticate_user, create_access_token, get_current_user, hash_password, require_admin
from config import get_settings
from database import (
    ChatLog,
    Document,
    DocumentKind,
    DocumentStatus,
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
    CreateUserRequest,
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
        query = query.filter(Document.status.in_([DocumentStatus.pending_approval, DocumentStatus.processing, DocumentStatus.ready, DocumentStatus.failed]))
    return [DocumentOut.model_validate(document) for document in query.all()]


@app.post("/documents/upload", response_model=DocumentOut)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentOut:
    kind = document_kind(file.filename or "")
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
    return upload_document(background_tasks=background_tasks, file=file, current_user=admin, db=db)


@app.post("/upload", response_model=DocumentOut)
def legacy_upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentOut:
    return upload_document(background_tasks=background_tasks, file=file, current_user=current_user, db=db)


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
    return answer_question(db, current_user, message)


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
            username=display_username(log.user),
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
