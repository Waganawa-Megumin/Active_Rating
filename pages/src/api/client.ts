// Active Rating — dashboard API client (read + admin).

const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:8787').replace(/\/$/, '');

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

export interface Rating {
  org_id: string;
  assets: { total: number; confirmed: number };
  severityCounts: Record<string, number>;
  score: number;
  grade: string;
  csf: { GV: number; ID: number; PR: number; DE: number; RS: number; RC: number };
  provisional: boolean;
}

export interface FpRate {
  total_disputes: number;
  retracted: number;
  upheld: number;
  fp_rate: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  base: API_BASE,
  health: () => getJson<{ ok: boolean; offline: boolean }>('/api/health'),
  organizations: () => getJson<Org[]>('/api/organizations'),
  changes: (limit = 200) => getJson<Change[]>(`/api/changes?limit=${limit}`),
  assets: (limit = 500) => getJson<Array<Record<string, unknown>>>(`/api/assets?limit=${limit}`),
  rating: (orgId: string) => getJson<Rating>(`/api/rating/${orgId}`),
  fpRate: () => getJson<FpRate>('/api/fp-rate'),
  async registerOrg(token: string, body: unknown) {
    const res = await fetch(`${API_BASE}/admin/orgs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  },
  async registerDomain(token: string, body: unknown) {
    const res = await fetch(`${API_BASE}/admin/domains`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  },
};
