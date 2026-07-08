// Deferred visualization surfaces — scaffolded so P4–P6 slot in cleanly.

export function MttdRace() {
  return (
    <div className="panel">
      <h2>MTTD レース（vs BitSight）</h2>
      <div className="stub">
        <span className="phase">P4</span>
        <div>検知までの時間（MTTD）を BitSight と時系列比較。</div>
        <div className="hint">
          detection_latency（trigger=ct/kev/leak/bitsight）で mttd_sec を計測し、
          「BitSightより N日早い」を可視化。
        </div>
      </div>
    </div>
  );
}

export function WorldMap() {
  return (
    <div className="panel">
      <h2>世界地図（漏洩・フィッシング分布）</h2>
      <div className="stub">
        <span className="phase">P6</span>
        <div>MapLibre GL でコロプレス／ヒートマップ。</div>
        <div className="hint">
          クレデンシャル漏洩・フィッシングインフラの地理集中。無料タイルでトークン課金を回避。
        </div>
      </div>
    </div>
  );
}

export function AttackPath() {
  return (
    <div className="panel">
      <h2>アタックパスグラフ</h2>
      <div className="stub">
        <span className="phase">P5</span>
        <div>露出→脆弱性→クレデンシャル→資産 の連鎖を force-graph で。</div>
      </div>
    </div>
  );
}
