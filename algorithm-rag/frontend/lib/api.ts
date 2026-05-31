const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export type Role = 'admin' | 'people';
export type DocumentStatus = 'pending_approval' | 'processing' | 'ready' | 'failed';
export type DocumentKind = 'pdf' | 'markdown';
export type DocumentVisibility = 'private' | 'shared' | 'system';
export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

export type User = {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  is_active: boolean;
  is_builtin: boolean;
  created_at: string;
  deleted_at: string | null;
};

export type RegistrationRequest = {
  id: number;
  email: string;
  username: string;
  reason: string | null;
  status: RegistrationStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
};

export type DocumentItem = {
  id: number;
  filename: string;
  kind: DocumentKind;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  error_message: string | null;
  uploaded_by: number;
  approved_by: number | null;
  created_at: string;
  updated_at: string;
};

export type Source = {
  document_id: number;
  document_name: string;
  location: string;
  preview: string;
  score: number | null;
};

export type ChatResponse = {
  answer: string;
  sources: Source[];
  blocked: boolean;
  conversation_id: number;
  title: string;
};

export type ConversationMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  blocked: boolean;
  created_at: string;
};

export type Conversation = {
  id: number;
  user_id: number;
  username: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  messages: ConversationMessage[];
};

export type ConversationSummary = Omit<Conversation, 'messages'> & {
  message_count: number;
  last_message_preview: string | null;
};

export type ConversationSearchResult = {
  conversation_id: number;
  message_id: number;
  title: string;
  user_id: number;
  username: string | null;
  role: 'user' | 'assistant';
  snippet: string;
  created_at: string;
};

export type Prompt = {
  id: number;
  name: string;
  content: string;
  is_active: boolean;
  updated_at: string;
};

export type ChatLog = {
  id: number;
  username: string;
  question: string;
  answer: string;
  sources: Source[];
  blocked: boolean;
  created_at: string;
};

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function setToken(token: string) {
  localStorage.setItem('token', token);
}

export function clearToken() {
  localStorage.removeItem('token');
}

async function extractErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) return `请求失败：${response.status}`;
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    if (typeof payload.detail === 'string') return payload.detail;
    if (Array.isArray(payload.detail)) return payload.detail.map((item) => JSON.stringify(item)).join('; ');
  } catch {
    return text;
  }
  return `请求失败：${response.status}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(options.body instanceof FormData) && options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json() as Promise<T>;
}

export const api = {
  async login(username: string, password: string) {
    return request<{ access_token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  register: (payload: { email: string; username: string; password: string; reason?: string }) =>
    request<{ id: number; status: RegistrationStatus; message: string }>('/register', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request<User>('/auth/me'),
  documents: () => request<DocumentItem[]>('/documents'),
  upload(file: File, visibility: DocumentVisibility = 'private') {
    const form = new FormData();
    form.append('file', file);
    form.append('visibility', visibility);
    return request<DocumentItem>('/documents/upload', { method: 'POST', body: form });
  },
  approve: (id: number) => request<DocumentItem>(`/documents/${id}/approve`, { method: 'POST' }),
  retry: (id: number) => request<DocumentItem>(`/documents/${id}/retry`, { method: 'POST' }),
  chat: (message: string, conversationId?: number | null) => request<ChatResponse>('/chat', { method: 'POST', body: JSON.stringify({ message, conversation_id: conversationId ?? null }) }),
  conversations: () => request<ConversationSummary[]>('/conversations'),
  createConversation: () => request<Conversation>('/conversations', { method: 'POST' }),
  getConversation: (id: number) => request<Conversation>(`/conversations/${id}`),
  searchConversations: (query: string) => request<ConversationSearchResult[]>(`/conversations/search?q=${encodeURIComponent(query)}`),
  deleteConversation: (id: number) => request<Conversation>(`/conversations/${id}/delete`, { method: 'POST' }),
  adminConversations: () => request<ConversationSummary[]>('/admin/conversations'),
  adminGetConversation: (id: number) => request<Conversation>(`/admin/conversations/${id}`),
  adminSearchConversations: (query: string) => request<ConversationSearchResult[]>(`/admin/conversations/search?q=${encodeURIComponent(query)}`),
  adminDeleteConversation: (id: number) => request<Conversation>(`/admin/conversations/${id}/delete`, { method: 'POST' }),
  users: () => request<User[]>('/admin/users'),
  createUser: (payload: { username: string; password: string; role: Role; email?: string }) =>
    request<User>('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  resetPassword: (id: number, password: string) => request<User>(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
  deleteUser: (id: number) => request<User>(`/admin/users/${id}/delete`, { method: 'POST' }),
  registrationRequests: () => request<RegistrationRequest[]>('/admin/registration-requests'),
  approveRegistration: (id: number) => request<RegistrationRequest>(`/admin/registration-requests/${id}/approve`, { method: 'POST' }),
  rejectRegistration: (id: number) => request<RegistrationRequest>(`/admin/registration-requests/${id}/reject`, { method: 'POST' }),
  getPrompt: () => request<Prompt>('/admin/prompts/active'),
  updatePrompt: (content: string) => request<Prompt>('/admin/prompts/active', { method: 'PUT', body: JSON.stringify({ content }) }),
  chatLogs: () => request<ChatLog[]>('/admin/chat-logs'),
};
