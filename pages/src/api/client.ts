// Active Rating — dashboard API client (read + admin). Admin-only: every request
// carries the admin bearer token (entered at login, kept in sessionStorage).

const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:8787').replace(/\/$/, '');
const TOKEN_KEY = 'ar_admin_token';
const ACCOUNT_KEY = 'ar_admin_account';

/** Default admin account name (override at build via VITE_ADMIN_ACCOUNT). */
export const DEFAULT_ACCOUNT = import.meta.env.VITE_ADMIN_ACCOUNT ?? 'ar-admin';

function ss(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
export function getToken(): string {
  return ss(TOKEN_KEY);
}
export function getAccount(): string {
  return ss(ACCOUNT_KEY);
}
export function setToken(t: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* ignore */
  }
}
function setAccount(a: string): void {
  try {
    sessionStorage.setItem(ACCOUNT_KEY, a);
  } catch {
    /* ignore */
  }
}
export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* ignore */
  }
}
function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

export interface Org {
  id: string;
  name: string;
  parent_id: string | null;
  relation_type: string;
  active_confirmed: boolean;
  slack_channel: string | null;
  notes: string | null;
  profile: 'active' | 'passive';
}

export interface Domain {
  id: string;
  org_id: string;
  fqdn: string;
  enabled: boolean;
}

export interface Change {
  id: string;
  org_id: string;
  domain_id: string;
  asset_id: string | null;
  entity_type: string;
  change_type: 'ADDED' | 'REMOVED' | 'CHANGED';
  severity: 'info' | 'low' | 'med' | 'high' | 'critical';
  detected_at: string;
}

export interface VectorGrade {
  vector: string;
  grade: string;
  score: number;
}
export interface Rating {
  org_id: string;
  assets: { total: number; confirmed: number };
  severityCounts?: Record<string, number>;
  score: number;
  grade: string;
  confidence?: number;
  trend?: number;
  csf: { GV: number; ID: number; PR: number; DE: number; RS: number; RC: number };
  vectors?: VectorGrade[];
  provisional: boolean;
}

export interface Finding {
  id: string;
  asset_id: string;
  org_id: string;
  finding_type: string;
  severity: 'info' | 'low' | 'med' | 'high' | 'critical';
  status: string;
  sla_due: string | null;
  asset_identity: string;
  asset_entity_type: string;
}

export interface FpRate {
  total_disputes: number;
  retracted: number;
  upheld: number;
  fp_rate: number;
}

export class AuthError extends Error {}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (res.status === 401) throw new AuthError(`unauthorized: ${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  base: API_BASE,
  /** Validate an account name + token against the protected /api/session endpoint. */
  async login(account: string, token: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/session`, {
      headers: { authorization: `Bearer ${token}`, 'x-ar-user': account },
    });
    if (res.ok) {
      setToken(token);
      setAccount(account);
      return true;
    }
    return false;
  },
  account: getAccount,
  logout: clearToken,
  hasToken: () => getToken().length > 0,
  health: () => getJson<{ ok: boolean; offline: boolean }>('/api/health'),
  organizations: () => getJson<Org[]>('/api/organizations'),
  domains: () => getJson<Domain[]>('/api/domains'),
  changes: (limit = 200) => getJson<Change[]>(`/api/changes?limit=${limit}`),
  assets: (limit = 500) => getJson<Array<Record<string, unknown>>>(`/api/assets?limit=${limit}`),
  rating: (orgId: string) => getJson<Rating>(`/api/rating/${orgId}`),
  findings: (limit = 100) => getJson<Finding[]>(`/api/findings?limit=${limit}`),
  fpRate: () => getJson<FpRate>('/api/fp-rate'),
  async dispute(asset_id: string, claim: string) {
    const res = await fetch(`${API_BASE}/dispute`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ asset_id, claim }),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  },
  async registerOrg(body: unknown) {
    const res = await fetch(`${API_BASE}/admin/orgs`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  },
  async registerDomain(body: unknown) {
    const res = await fetch(`${API_BASE}/admin/domains`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  },
  async deleteOrg(id: string) {
    const res = await fetch(`${API_BASE}/admin/orgs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return { ok: res.ok, status: res.status };
  },
  async deleteDomain(id: string) {
    const res = await fetch(`${API_BASE}/admin/domains/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return { ok: res.ok, status: res.status };
  },
};
