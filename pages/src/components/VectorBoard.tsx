import type { Rating } from '../api/client.js';

// 9ベクター信号盤 (design v0.6 §D). Reads the deterministic A–F grades computed
// by the worker's evaluation step (persisted attack_vectors).
const LABEL: Record<string, string> = {
  vpn: 'VPN',
  webapp: 'WebApp',
  email: 'Email',
  dns: 'DNS',
  credential: 'Credential',
  cloud: 'Cloud',
  pki: 'PKI',
  netsvc: 'NetSvc',
  compromise: 'Compromise',
};
const ORDER = ['vpn', 'webapp', 'email', 'dns', 'credential', 'cloud', 'pki', 'netsvc', 'compromise'];
const GRADE_COLOR: Record<string, string> = {
  A: 'var(--accent)',
  B: '#7fd04a',
  C: '#e8b339',
  D: '#ef8a5a',
  F: '#ef5a5a',
};

export function VectorBoard({ rating }: { rating: Rating | null }) {
  const map = new Map((rating?.vectors ?? []).map((v) => [v.vector, v]));
  return (
    <div className="panel">
      <h2>ベクター信号盤（A–F）</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>
        {ORDER.map((key) => {
          const v = map.get(key);
          const grade = v?.grade ?? '—';
          const color = GRADE_COLOR[grade] ?? 'var(--muted)';
          return (
            <div
              key={key}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--panel-2)',
              }}
              title={v ? `score ${v.score}` : undefined}
            >
              <span style={{ fontSize: 12.5, color: 'var(--fg-dim, var(--muted))' }}>{LABEL[key]}</span>
              <span style={{ fontWeight: 800, fontSize: 18, color }}>{grade}</span>
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Findings の重大度から決定論的に算出（数値は決定論・LLMは批評のみ）。脅威加重・検知ギャップはP4/P5。
      </div>
    </div>
  );
}
