import type { Change } from '../api/client.js';

// 9ベクター信号盤 (design v0.6 §D). P1: derive a coarse A–F signal per vector
// from the change/severity mix mapped to attack vectors. Full grade algorithm +
// threat weighting is P5.
const VECTORS: Array<{ key: string; label: string; types: string[] }> = [
  { key: 'vpn', label: 'VPN', types: ['vpn'] },
  { key: 'webapp', label: 'WebApp', types: ['web'] },
  { key: 'email', label: 'Email', types: ['email_auth'] },
  { key: 'dns', label: 'DNS', types: ['dns', 'subdomain'] },
  { key: 'credential', label: 'Credential', types: ['exposure'] },
  { key: 'cloud', label: 'Cloud', types: ['exposure'] },
  { key: 'pki', label: 'PKI', types: ['cert'] },
  { key: 'netsvc', label: 'NetSvc', types: ['service'] },
  { key: 'compromise', label: 'Compromise', types: [] },
];

const SEV_PENALTY: Record<string, number> = { info: 0, low: 1, med: 4, high: 12, critical: 30 };

function grade(score: number): { g: string; c: string } {
  if (score >= 90) return { g: 'A', c: '#37d0a0' };
  if (score >= 80) return { g: 'B', c: '#7fd04a' };
  if (score >= 65) return { g: 'C', c: '#e8b339' };
  if (score >= 50) return { g: 'D', c: '#ef8a5a' };
  return { g: 'F', c: '#ef5a5a' };
}

export function VectorBoard({ changes }: { changes: Change[] }) {
  return (
    <div className="panel">
      <h2>ベクター信号盤（A–F）</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {VECTORS.map((v) => {
          const penalty = changes
            .filter((c) => v.types.includes(c.entity_type))
            .reduce((acc, c) => acc + (SEV_PENALTY[c.severity] ?? 0), 0);
          const score = Math.max(0, 100 - penalty);
          const { g, c } = grade(score);
          return (
            <div
              key={v.key}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13 }}>{v.label}</span>
              <span style={{ fontWeight: 800, fontSize: 18, color: c }}>{g}</span>
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        暫定グレード。脅威加重（ATT&amp;CK）・検知ギャップ反映はP5。
      </div>
    </div>
  );
}
