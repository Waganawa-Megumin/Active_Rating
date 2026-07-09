import { useCallback, useEffect, useState } from 'react';
import { api, AuthError, type Change, type FpRate, type Org, type Rating } from './api/client.js';
import { Login } from './components/Login.js';
import { RatingGauge } from './components/RatingGauge.js';
import { CsfRadar } from './components/CsfRadar.js';
import { OrgTree } from './components/OrgTree.js';
import { ChangesTimeline } from './components/ChangesTimeline.js';
import { WorldMap } from './components/WorldMap.js';
import { VectorBoard } from './components/VectorBoard.js';
import { DisputePanel } from './components/DisputePanel.js';
import { TargetsAdmin } from './components/TargetsAdmin.js';
import { MttdRace, AttackPath } from './components/Stubs.js';

type Tab = 'dashboard' | 'targets';

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => api.hasToken());
  const [tab, setTab] = useState<Tab>('dashboard');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [assets, setAssets] = useState<Array<Record<string, unknown>>>([]);
  const [rating, setRating] = useState<Rating | null>(null);
  const [fp, setFp] = useState<FpRate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    try {
      const [o, c, a, f] = await Promise.all([
        api.organizations(),
        api.changes(200),
        api.assets(500),
        api.fpRate(),
      ]);
      setOrgs(o);
      setChanges(c);
      setAssets(a);
      setFp(f);
      setError(null);
      setSelectedOrg((prev) => prev ?? o.find((x) => x.relation_type === 'self')?.id ?? o[0]?.id ?? null);
    } catch (e) {
      if (e instanceof AuthError) {
        api.logout();
        setAuthed(false);
        return;
      }
      setError(`${api.base} に接続できません。`);
    }
  }, []);

  useEffect(() => {
    if (authed) void loadBase();
  }, [authed, loadBase]);

  useEffect(() => {
    if (!selectedOrg) return;
    api.rating(selectedOrg).then(setRating).catch(() => setRating(null));
  }, [selectedOrg, changes.length]);

  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

  return (
    <div className="app">
      <div className="topbar">
        <h1>
          <span className="tag">Active</span> Rating
        </h1>
        <span className="subtitle" style={{ margin: 0 }}>
          能動検証・証跡主義の攻撃面評価 — 受動的で誤りだらけの評価を置き換える
        </span>
      </div>

      <div className="tabs">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>
          ダッシュボード
        </button>
        <button className={tab === 'targets' ? 'active' : ''} onClick={() => setTab('targets')}>
          Targets / 登録
        </button>
        <button onClick={() => void loadBase()} style={{ marginLeft: 'auto' }}>
          ⟳ 更新
        </button>
        <button
          onClick={() => {
            api.logout();
            setAuthed(false);
          }}
        >
          ログアウト
        </button>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--sev-high)', marginBottom: 16 }}>
          <div className="result err">{error}</div>
        </div>
      )}

      {tab === 'dashboard' ? (
        <>
          {/* Hero: the rating is the headline, not the map. */}
          <div className="grid hero" style={{ marginBottom: 16 }}>
            <RatingGauge rating={rating} />
            <DisputePanel fp={fp} />
          </div>

          <div className="grid cols-3" style={{ marginBottom: 16 }}>
            <VectorBoard changes={changes} />
            <CsfRadar rating={rating} />
            <MttdRace />
          </div>

          <div className="grid cols-2" style={{ marginBottom: 16 }}>
            <OrgTree orgs={orgs} onSelect={setSelectedOrg} selected={selectedOrg} />
            <ChangesTimeline changes={changes} />
          </div>

          {/* Secondary: geo distribution lives lower, not at the top. */}
          <div className="grid cols-2">
            <AttackPath />
            <WorldMap assets={assets} />
          </div>
        </>
      ) : (
        <>
          <TargetsAdmin orgs={orgs} onChanged={loadBase} />
          <div style={{ height: 16 }} />
          <OrgTree orgs={orgs} onSelect={setSelectedOrg} selected={selectedOrg} />
        </>
      )}
    </div>
  );
}
