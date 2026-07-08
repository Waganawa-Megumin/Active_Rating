import type { Org } from '../api/client.js';

const REL_LABEL: Record<string, string> = {
  self: '自組織',
  subsidiary: '子会社',
  supplier: 'サプライヤ',
  partner: '提携先',
  watch: '監視対象',
};

function Node({ org, all, onSelect, selected }: {
  org: Org;
  all: Org[];
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  const children = all.filter((o) => o.parent_id === org.id);
  return (
    <li>
      <span
        className="name"
        style={{ cursor: 'pointer', color: selected === org.id ? 'var(--accent)' : undefined }}
        onClick={() => onSelect(org.id)}
      >
        {org.name}
      </span>{' '}
      <span className="badge rel">{REL_LABEL[org.relation_type] ?? org.relation_type}</span>{' '}
      <span className={`badge ${org.profile}`}>{org.profile}</span>
      {org.active_confirmed && org.relation_type !== 'self' && (
        <span className="hint"> ・所有確認済</span>
      )}
      {children.length > 0 && (
        <ul>
          {children.map((c) => (
            <Node key={c.id} org={c} all={all} onSelect={onSelect} selected={selected} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgTree({ orgs, onSelect, selected }: {
  orgs: Org[];
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  const roots = orgs.filter((o) => !o.parent_id);
  return (
    <div className="panel">
      <h2>組織ツリー（スキャン強度）</h2>
      {orgs.length === 0 ? (
        <div className="hint">組織未登録。「Targets / 登録」から追加してください。</div>
      ) : (
        <ul className="tree">
          {roots.map((r) => (
            <Node key={r.id} org={r} all={orgs} onSelect={onSelect} selected={selected} />
          ))}
        </ul>
      )}
    </div>
  );
}
