from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from database import DocumentKind, DocumentStatus, RegistrationStatus, UserRole


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None
    role: UserRole
    is_active: bool
    is_builtin: bool
    created_at: datetime
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=6, max_length=200)
    role: UserRole = UserRole.people
    email: str | None = Field(default=None, max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if not value:
            return None
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("请输入有效邮箱")
        return value

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("请输入用户名")
        return value


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=6, max_length=200)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=6, max_length=200)
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("请输入有效邮箱")
        return value

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("请输入用户名")
        return value

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class RegisterResponse(BaseModel):
    id: int
    status: RegistrationStatus
    message: str


class RegistrationRequestOut(BaseModel):
    id: int
    email: str
    username: str
    reason: str | None
    status: RegistrationStatus
    reviewed_by: int | None
    reviewed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentOut(BaseModel):
    id: int
    filename: str
    kind: DocumentKind
    status: DocumentStatus
    error_message: str | None
    uploaded_by: int
    approved_by: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SourceOut(BaseModel):
    document_id: int
    document_name: str
    location: str
    preview: str
    score: float | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceOut]
    blocked: bool = False


class PromptOut(BaseModel):
    id: int
    name: str
    content: str
    is_active: bool
    updated_at: datetime

    model_config = {"from_attributes": True}


class PromptUpdateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=12000)


class ChatLogOut(BaseModel):
    id: int
    username: str
    question: str
    answer: str
    sources: list[dict[str, Any]]
    blocked: bool
    created_at: datetime
