function getApiBase(): string {
  return localStorage.getItem('admin_portal_url') || 'http://localhost:8080';
}

function getToken(): string {
  return localStorage.getItem('admin_token') || '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${getApiBase()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (resp.status === 401 && !path.startsWith('/auth/')) {
    localStorage.removeItem('admin_token');
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (resp.status === 204) return undefined as T;

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || resp.statusText);
  }

  return resp.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: (path: string) => request<void>('DELETE', path),
};

export interface LoginResponse { token: string; user_id: string }
export interface MeResponse { user_id: string; role: string }

export interface Department {
  id: string;
  name: string;
  backend_url: string;
  frontend_url: string;
  admin_username: string;
  admin_password: string;
  created_at: string;
}

export interface DeptSummary {
  id: string;
  name: string;
  backend_url: string;
  online: boolean;
  agent_count: number;
  user_count: number;
}

export interface DashboardData {
  total_departments: number;
  online_departments: number;
  total_agents: number;
  total_users: number;
  departments: DeptSummary[];
}

export interface OrchestrationLog {
  id: string;
  task_type: string;
  task_prompt: string;
  department_ids: string[];
  results: Record<string, string> | null;
  status: string;
  created_at: string;
  finished_at: string | null;
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { username, password }),
  me: () => api.get<MeResponse>('/auth/me'),
};

export const deptApi = {
  list: () => api.get<Department[]>('/departments/'),
  get: (id: string) => api.get<Department>(`/departments/${id}`),
  create: (data: { name: string; backend_url: string; frontend_url?: string; admin_username: string; admin_password: string }) =>
    api.post<Department>('/departments/', data),
  update: (id: string, data: Partial<{ name: string; backend_url: string; frontend_url: string; admin_username: string; admin_password: string }>) =>
    api.put<Department>(`/departments/${id}`, data),
  delete: (id: string) => api.del(`/departments/${id}`),
  health: (id: string) => api.get<{ id: string; name: string; online: boolean }>(`/departments/${id}/health`),
  testConnection: (id: string) => api.post<{ ok: boolean; detail?: string }>(`/departments/${id}/test-connection`),
};

export const dashboardApi = {
  get: () => api.get<DashboardData>('/dashboard/'),
};

export const orchestrateApi = {
  run: (prompt: string, department_ids: string[]) =>
    api.post<{ id: string; status: string; results: Record<string, string> }>('/orchestrate/run', { prompt, department_ids }),
  logs: () => api.get<OrchestrationLog[]>('/orchestrate/logs'),
  log: (id: string) => api.get<OrchestrationLog>(`/orchestrate/logs/${id}`),
};

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
}

export interface DeptAgents {
  department_id: string;
  department_name: string;
  backend_url: string;
  frontend_url: string;
  agents: AgentInfo[];
}

export interface ChatMessage {
  role: string;
  text: string;
}

export const agentsApi = {
  all: () => api.get<{ departments: DeptAgents[] }>('/dashboard/agents'),
};

export const chatApi = {
  start: (department_id: string, agent_id: string) =>
    api.post<{ session_id: string; department_id: string; agent_id: string }>('/chat/start', { department_id, agent_id }),
  send: (department_id: string, agent_id: string, session_id: string, text: string) =>
    api.post<{ reply: string }>('/chat/send', { department_id, agent_id, session_id, text }),
  messages: (department_id: string, agent_id: string, session_id: string) =>
    api.get<{ messages: ChatMessage[] }>(`/chat/messages?department_id=${department_id}&agent_id=${agent_id}&session_id=${session_id}`),
};
