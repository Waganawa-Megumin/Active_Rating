import { useCallback, useEffect, useState } from 'react';
import { api, type Finding } from '../api/client.js';

const TYPE_LABEL: Record<string, string> = {
  exposed_service: '露出サービス',
  vpn_cred_exposure: 'クレデンシャル漏洩',
  vpn_misconfig: 'VPN設定不備',
  pki: 'PKI/証明書',
  takeover: 'テイクオーバー',
  cve: '既知脆弱性',
  tls: 'TLS',
  email_auth: 'メール認証',
  typosquat: 'タイポスクワット',
};

function slaLabel(sla: string | null): { text: string; over: boolean } {
  if (!sla) return { text: '—', over: false };
  const due = Date.parse(sla);
  const days = Math.round((due - Date.now()) / 86400000);
  if (days < 0) return { text: `超過 ${-days}日`, over: true };
  return { text: `残 ${days}日`, over: false };
}

export function FindingsPanel({ refreshKey }: { refreshKey: number }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .findings(50)
      .then((f) => {
        setFindings(f);
        setErr(null);
      })
      .catch(() => setErr('findings を取得できません'));
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function dispute(f: Finding) {
    const claim = window.prompt(
      `反証申立て — 「${f.asset_identity}」の評価は誤りだと主張しますか？根拠を入力してください。`,
      'この資産は当社の管理下にありません',
    );
    if (!claim) return;
    const res = await api.dispute(f.asset_id, claim);
    const outcome = (res.body as { outcome?: string }).outcome;
    setNote((n) => ({
      ...n,
      [f.id]: res.ok
        ? outcome === 'retracted'
          ? '撤回（証跡期限切れ/不成立 → FP率へ反映）'
          : '維持（証跡は依然有効）'
        : `失敗 HTTP ${res.status}`,
    }));
    if (res.ok && outcome === 'retracted') setTimeout(load, 400);
  }

  return (
    <div className="panel">
      <h2>要対応 Top N（Findings・証跡付き）</h2>
      {err && <div className="result err">{err}</div>}
      {findings.length === 0 ? (
        <div className="hint">未対応の finding はありません。スキャンで検出されるとここに出ます。</div>
      ) : (
        <div className="findings">
          {findings.map((f) => {
            const sla = slaLabel(f.sla_due);
            return (
              <div className="frow" key={f.id}>
                <span className={`sev ${f.severity}`}>{f.severity}</span>
                <span className="ftype">{TYPE_LABEL[f.finding_type] ?? f.finding_type}</span>
                <span className="fasset mono">
                  <small>{f.asset_entity_type}</small> {f.asset_identity}
                </span>
                <span className={`fsla ${sla.over ? 'over' : ''}`}>{sla.text}</span>
                <button className="dispute" onClick={() => dispute(f)} title="反証を申し立てる">
                  反証
                </button>
                {note[f.id] && <span className="fnote">{note[f.id]}</span>}
              </div>
            );
          })}
        </div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>
        各 finding は現在の資産状態から決定論的に導出。反証で証跡を再検証し、不成立なら自動撤回して FP 率に反映。
      </div>
    </div>
  );
}
