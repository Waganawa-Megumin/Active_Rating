import { useState } from 'react';
import { api, type Org } from '../api/client.js';

// Target-asset REGISTRATION UI (Phase 1). Adds/edit orgs + domains via the
// authenticated Admin API. The active_confirmed gate is surfaced explicitly.
export function TargetsAdmin({ orgs, onChanged }: { orgs: Org[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('self');
  const [parent, setParent] = useState('');
  const [activeConfirmed, setActiveConfirmed] = useState(false);
  const [slack, setSlack] = useState('');

  const [domOrg, setDomOrg] = useState('');
  const [fqdn, setFqdn] = useState('');

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const canActive = relation === 'self' || relation === 'subsidiary';

  async function submitOrg(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.registerOrg({
      name,
      parent_id: parent || null,
      relation_type: relation,
      active_confirmed: canActive && activeConfirmed,
      slack_channel: slack || null,
    });
    setMsg({
      ok: res.ok,
      text: res.ok
        ? `登録: ${name} (${(res.body as Record<string, unknown>).relation_type}, active=${(res.body as Record<string, unknown>).active_confirmed})`
        : `失敗 HTTP ${res.status}`,
    });
    if (res.ok) {
      setName('');
      onChanged();
    }
  }

  async function submitDomain(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.registerDomain({ org_id: domOrg, fqdn, enabled: true });
    setMsg({ ok: res.ok, text: res.ok ? `ドメイン登録: ${fqdn}` : `失敗 HTTP ${res.status}` });
    if (res.ok) {
      setFqdn('');
      onChanged();
    }
  }

  return (
    <div className="grid cols-2">
      <div className="panel">
        <h2>組織の登録 / 編集</h2>
        <form className="reg" onSubmit={submitOrg}>
          <label>
            組織名
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="ACME Holdings" />
          </label>
          <div className="rowflex">
            <label style={{ flex: 1 }}>
              関係
              <select value={relation} onChange={(e) => setRelation(e.target.value)}>
                <option value="self">self 自組織</option>
                <option value="subsidiary">subsidiary 子会社</option>
                <option value="supplier">supplier サプライヤ</option>
                <option value="partner">partner 提携先</option>
                <option value="watch">watch 監視対象</option>
              </select>
            </label>
            <label style={{ flex: 1 }}>
              親組織（任意）
              <select value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">（なし / ルート）</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="rowflex" style={{ opacity: canActive ? 1 : 0.4 }}>
            <input
              type="checkbox"
              checked={activeConfirmed}
              disabled={!canActive}
              onChange={(e) => setActiveConfirmed(e.target.checked)}
            />
            active_confirmed（能動スキャン許可）— self/subsidiary のみ
          </label>
          <label>
            Slack チャンネル（任意）
            <input value={slack} onChange={(e) => setSlack(e.target.value)} placeholder="#asm-acme" />
          </label>
          <button className="primary" type="submit">
            組織を登録
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>ドメインの登録</h2>
        <form className="reg" onSubmit={submitDomain}>
          <label>
            対象組織
            <select value={domOrg} onChange={(e) => setDomOrg(e.target.value)} required>
              <option value="">（選択）</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            FQDN
            <input value={fqdn} onChange={(e) => setFqdn(e.target.value)} required placeholder="example.com" />
          </label>
          <button className="primary" type="submit" disabled={!domOrg}>
            ドメインを登録
          </button>
        </form>
        <div className="hint" style={{ marginTop: 12 }}>
          一括登録は <span className="mono">targets.yaml</span> ＋{' '}
          <span className="mono">npm run register</span>（GitOps）でも可能です。
        </div>
        {msg && <div className={`result ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
      </div>
    </div>
  );
}
