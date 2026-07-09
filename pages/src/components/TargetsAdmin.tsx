import { useCallback, useEffect, useRef, useState } from 'react';
import { parse as parseYaml } from 'yaml';
import { api, type Domain, type Org } from '../api/client.js';

const RELATIONS: Array<{ v: string; label: string }> = [
  { v: 'self', label: 'self 自組織' },
  { v: 'subsidiary', label: 'subsidiary 子会社' },
  { v: 'supplier', label: 'supplier サプライヤ' },
  { v: 'partner', label: 'partner 提携先' },
  { v: 'watch', label: 'watch 監視対象' },
];

type Msg = { ok: boolean; text: string } | null;

// Target-asset REGISTRATION + management (Phase 1). Register orgs/domains, bulk
// import from a targets.yaml/json file, and delete mistaken entries.
export function TargetsAdmin({ orgs, onChanged }: { orgs: Org[]; onChanged: () => void }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [msg, setMsg] = useState<Msg>(null);

  const loadDomains = useCallback(() => {
    api.domains().then(setDomains).catch(() => setDomains([]));
  }, []);
  useEffect(() => {
    loadDomains();
  }, [loadDomains, orgs.length]);

  const refresh = () => {
    onChanged();
    loadDomains();
  };

  // ---- org form ----
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('self');
  const [parent, setParent] = useState('');
  const [activeConfirmed, setActiveConfirmed] = useState(false);
  const [slack, setSlack] = useState('');
  const isRoot = relation === 'self';
  const canActive = relation === 'self' || relation === 'subsidiary';

  async function submitOrg(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.registerOrg({
      name: name.trim(),
      parent_id: isRoot ? null : parent || null,
      relation_type: relation,
      active_confirmed: canActive && activeConfirmed,
      slack_channel: slack || null,
    });
    setMsg({ ok: res.ok, text: res.ok ? `組織を登録: ${name}` : `失敗 HTTP ${res.status}` });
    if (res.ok) {
      setName('');
      setSlack('');
      refresh();
    }
  }

  // ---- domain form ----
  const [domOrg, setDomOrg] = useState('');
  const [fqdn, setFqdn] = useState('');
  async function submitDomain(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.registerDomain({ org_id: domOrg, fqdn: fqdn.trim(), enabled: true });
    setMsg({ ok: res.ok, text: res.ok ? `ドメインを登録: ${fqdn}` : `失敗 HTTP ${res.status}` });
    if (res.ok) {
      setFqdn('');
      refresh();
    }
  }

  // ---- delete ----
  async function delOrg(o: Org) {
    if (!confirm(`組織「${o.name}」と配下のドメイン・スキャンデータを削除します。よろしいですか？`)) return;
    const res = await api.deleteOrg(o.id);
    setMsg({ ok: res.ok, text: res.ok ? `削除: ${o.name}` : `削除失敗 HTTP ${res.status}` });
    if (res.ok) refresh();
  }
  async function delDomain(d: Domain) {
    if (!confirm(`ドメイン「${d.fqdn}」と関連データを削除します。よろしいですか？`)) return;
    const res = await api.deleteDomain(d.id);
    setMsg({ ok: res.ok, text: res.ok ? `削除: ${d.fqdn}` : `削除失敗 HTTP ${res.status}` });
    if (res.ok) refresh();
  }

  // ---- bulk import from file (targets.yaml / json) ----
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMsg(null);
    try {
      const doc = parseYaml(await file.text()) as unknown;
      const list = normalizeOrgs(doc);
      if (list.length === 0) throw new Error('organizations が見つかりません');
      const result = await bulkRegister(list);
      setMsg({
        ok: result.errors === 0,
        text: `一括登録: 組織 ${result.orgs}・ドメイン ${result.doms}` +
          (result.errors ? ` / エラー ${result.errors}` : ' 完了'),
      });
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: `読み込み失敗: ${(err as Error).message}` });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="grid cols-2">
        {/* org registration */}
        <div className="panel">
          <h2>組織の登録</h2>
          <form className="reg" onSubmit={submitOrg}>
            <label>
              組織名
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="NEC Corporation" />
            </label>
            <label>
              関係
              <select value={relation} onChange={(e) => setRelation(e.target.value)}>
                {RELATIONS.map((r) => (
                  <option key={r.v} value={r.v}>{r.label}</option>
                ))}
              </select>
            </label>
            {!isRoot && (
              <label>
                親組織
                <select value={parent} onChange={(e) => setParent(e.target.value)}>
                  <option value="">（なし / ルート）</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </label>
            )}
            {isRoot && (
              <div className="hint">self（自組織）はツリーのルートとして登録されます（親組織なし）。</div>
            )}
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
              <input value={slack} onChange={(e) => setSlack(e.target.value)} placeholder="#asm-nec" />
            </label>
            <button className="primary" type="submit">組織を登録</button>
          </form>
        </div>

        {/* domain registration + bulk import */}
        <div className="panel">
          <h2>ドメインの登録</h2>
          <form className="reg" onSubmit={submitDomain}>
            <label>
              対象組織
              <select value={domOrg} onChange={(e) => setDomOrg(e.target.value)} required>
                <option value="">（選択）</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <label>
              FQDN
              <input value={fqdn} onChange={(e) => setFqdn(e.target.value)} required placeholder="nec.com" />
            </label>
            <button className="primary" type="submit" disabled={!domOrg}>ドメインを登録</button>
          </form>

          <div style={{ borderTop: '1px solid var(--line)', margin: '14px 0 12px' }} />
          <h2>ファイルから一括登録</h2>
          <div className="hint" style={{ marginBottom: 8 }}>
            <span className="mono">targets.yaml</span> / JSON（<span className="mono">organizations:[…]</span> 形式）を選択すると一括 upsert します。
          </div>
          <input ref={fileRef} type="file" accept=".yaml,.yml,.json,.txt" onChange={onFile} disabled={importing} />
          {importing && <span className="hint"> 取り込み中…</span>}
        </div>
      </div>

      {msg && <div className={`result ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      {/* management: delete mistaken entries */}
      <div className="grid cols-2">
        <div className="panel">
          <h2>登録済み組織（削除可）</h2>
          {orgs.length === 0 ? (
            <div className="hint">組織未登録。</div>
          ) : (
            <ul className="manage">
              {orgs.map((o) => (
                <li key={o.id}>
                  <span className="nm">{o.name}</span>
                  <span className="badge rel">{o.relation_type}</span>
                  <span className={`badge ${o.profile}`}>{o.profile}</span>
                  <button className="del" title="削除" onClick={() => delOrg(o)}>🗑</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <h2>登録済みドメイン（削除可）</h2>
          {domains.length === 0 ? (
            <div className="hint">ドメイン未登録。</div>
          ) : (
            <ul className="manage">
              {domains.map((d) => {
                const org = orgs.find((o) => o.id === d.org_id);
                return (
                  <li key={d.id}>
                    <span className="nm mono">{d.fqdn}</span>
                    <span className="hint">{org?.name ?? d.org_id}</span>
                    <button className="del" title="削除" onClick={() => delDomain(d)}>🗑</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- bulk import helpers ----
interface OrgDecl {
  key?: string;
  name: string;
  parent?: string;
  relation_type: string;
  active_confirmed?: boolean;
  slack_channel?: string;
  notes?: string;
  domains?: Array<{ fqdn: string; enabled?: boolean }>;
}

function normalizeOrgs(doc: unknown): OrgDecl[] {
  if (Array.isArray(doc)) return doc as OrgDecl[];
  if (doc && typeof doc === 'object' && Array.isArray((doc as { organizations?: unknown }).organizations)) {
    return (doc as { organizations: OrgDecl[] }).organizations;
  }
  return [];
}

async function bulkRegister(list: OrgDecl[]): Promise<{ orgs: number; doms: number; errors: number }> {
  const keyToId = new Map<string, string>();
  const pending = [...list];
  let orgs = 0;
  let doms = 0;
  let errors = 0;
  let guard = pending.length * 3 + 2;

  while (pending.length && guard-- > 0) {
    const org = pending.shift()!;
    if (org.parent && !keyToId.has(org.parent)) {
      pending.push(org); // defer until parent registered
      continue;
    }
    const parent_id = org.parent ? keyToId.get(org.parent) ?? null : null;
    const res = await api.registerOrg({
      name: org.name,
      parent_id,
      relation_type: org.relation_type,
      active_confirmed: !!org.active_confirmed,
      slack_channel: org.slack_channel ?? null,
      notes: org.notes ?? null,
    });
    if (!res.ok) {
      errors++;
      continue;
    }
    orgs++;
    const id = String((res.body as { id?: string }).id ?? '');
    if (org.key) keyToId.set(org.key, id);
    for (const d of org.domains ?? []) {
      const dr = await api.registerDomain({ org_id: id, fqdn: d.fqdn, enabled: d.enabled ?? true });
      if (dr.ok) doms++;
      else errors++;
    }
  }
  if (pending.length) errors += pending.length; // unresolved parents
  return { orgs, doms, errors };
}
