const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('dashboard_token');
}

export function setToken(token: string): void {
  localStorage.setItem('dashboard_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('dashboard_token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }

  // Handle text/plain responses (dashboard-summary)
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/plain')) return (await res.text()) as unknown as T;

  return res.json();
}

// Auth
export const login = (username: string, password: string) =>
  apiFetch<{ token: string; username: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

// Metrics
export const getMetrics = () => apiFetch<Record<string, unknown>>('/metrics');
export const getMetricsHistory = (hours = 24) =>
  apiFetch<{ hours: number; resolution: string; data: unknown[] }>(`/metrics/history?hours=${hours}`);

// Events
export const getEvents = (params: { traceId?: string; level?: string; type?: string; limit?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.traceId) qs.set('traceId', params.traceId);
  if (params.level) qs.set('level', params.level);
  if (params.type) qs.set('type', params.type);
  if (params.limit) qs.set('limit', String(params.limit));
  return apiFetch<{ total: number; events: unknown[] }>(`/events?${qs}`);
};

// Leads
export const getLeads = (params: Record<string, string | number> = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
  return apiFetch<{ total: number; leads: unknown[] }>(`/leads?${qs}`);
};
export const getLeadFacets = (params: Record<string, string> = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  return apiFetch<{ states: string[]; cities: string[]; industries: string[]; statuses: string[] }>(`/leads/facets?${qs}`);
};
export const getLead = (id: string) => apiFetch<Record<string, unknown>>(`/leads/${id}`);
export const updateLead = (id: string, data: Record<string, unknown>) =>
  apiFetch<{ success: boolean }>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteLead = (id: string) =>
  apiFetch<{ success: boolean }>(`/leads/${id}`, { method: 'DELETE' });

// Conversations
export const getConversations = (params: { channelId?: string; page?: number; limit?: number; search?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.channelId) qs.set('channelId', params.channelId);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  return apiFetch<{ messages: unknown[]; channels: unknown[] }>(`/conversations?${qs}`);
};

// Preferences
export const getPreferences = () => apiFetch<{ theme: { mode: string; accent: string } }>('/preferences');
export const savePreferences = (theme: { mode: string; accent: string }) =>
  apiFetch<{ success: boolean }>('/preferences', { method: 'PUT', body: JSON.stringify({ theme }) });

// Dashboard summary
export const getDashboardSummary = () => apiFetch<string>('/dashboard-summary');

// Health
export const getHealth = () => apiFetch<{ status: string }>('/health');
