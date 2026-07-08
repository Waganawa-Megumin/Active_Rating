import { useEffect, useRef, useState } from 'react';

interface Pt {
  lat: number;
  lng: number;
  label: string;
  estimated: boolean;
  size: number;
}

// Deterministic pseudo-geo from an id (P1 has no MaxMind geo yet). Points are
// marked "estimated" and colored accordingly — honest per design v0.7 §C-3.
function pseudoGeo(id: string): { lat: number; lng: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const lat = ((h % 12000) / 100) - 60; // -60..60
  const lng = (((h >> 8) % 36000) / 100) - 180; // -180..180
  return { lat, lng };
}

export function Globe({ assets }: { assets: Array<Record<string, unknown>> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  const points: Pt[] = assets.slice(0, 300).map((a) => {
    const g = pseudoGeo(String(a.id));
    const confirmed = a.state === 'confirmed';
    return {
      lat: g.lat,
      lng: g.lng,
      label: `${a.entity_type}: ${a.identity}`,
      estimated: !confirmed,
      size: confirmed ? 0.5 : 0.3,
    };
  });

  useEffect(() => {
    let globe: { _destructor?: () => void } | null = null;
    let cancelled = false;
    (async () => {
      if (!ref.current) return;
      try {
        const mod = await import('globe.gl');
        if (cancelled || !ref.current) return;
        const GlobeGL = mod.default;
        globe = GlobeGL()(ref.current)
          .width(ref.current.clientWidth)
          .height(340)
          .backgroundColor('#0a0e14')
          .showGlobe(true)
          .showAtmosphere(true)
          .atmosphereColor('#37d0a0')
          .globeImageUrl('')
          .pointsData(points)
          .pointLat('lat')
          .pointLng('lng')
          .pointColor((d: object) => ((d as Pt).estimated ? '#e8b339' : '#37d0a0'))
          .pointAltitude((d: object) => (d as Pt).size * 0.1)
          .pointRadius(0.4)
          .pointLabel((d: object) => (d as Pt).label);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      try {
        globe?._destructor?.();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.length]);

  return (
    <div className="panel">
      <h2>3D 地球儀 — 攻撃面（確定=緑 / 推測=黄）</h2>
      {failed ? (
        <div className="globe-wrap stub">
          <div>WebGL を初期化できませんでした（ヘッドレス環境など）。</div>
          <div className="hint">{points.length} 資産を配置予定。ブラウザで表示すると地球儀が描画されます。</div>
        </div>
      ) : (
        <div ref={ref} className="globe-wrap" />
      )}
      <div className="hint">
        IP Geo は CDN/クラウドで実体とズレるため、確定帰属と推測を色分け（誇張しない）。
      </div>
    </div>
  );
}
