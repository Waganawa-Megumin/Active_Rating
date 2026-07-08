import type { Change } from '../api/client.js';

export function ChangesTimeline({ changes }: { changes: Change[] }) {
  return (
    <div className="panel">
      <h2>差分タイムライン（証跡付き）</h2>
      {changes.length === 0 ? (
        <div className="hint">変更なし。スキャンを実行すると差分がここに出ます。</div>
      ) : (
        <div className="timeline">
          {changes.map((c) => (
            <div className="row" key={c.id}>
              <span className={`chg ${c.change_type}`}>{c.change_type}</span>
              <span className={`sev ${c.severity}`}>{c.severity}</span>
              <span className="mono">{c.entity_type}</span>
              <span className="ts">{new Date(c.detected_at).toLocaleString('ja-JP')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
