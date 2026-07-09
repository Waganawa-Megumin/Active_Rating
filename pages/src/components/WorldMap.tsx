import { useMemo } from 'react';
import { feature } from 'topojson-client';
import worldTopo from 'world-atlas/countries-110m.json';

// Minimal local geometry types (avoid pulling extra @types packages).
type Geom =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: string; coordinates: unknown };

// Self-contained SVG world map (equirectangular). No external tiles/network —
// the country geometry is bundled. Asset points are plotted by geo; confirmed
// attribution vs Geo estimate are color-coded (design v0.7 §C-3, honest map).

const W = 720;
const H = 360;

function project(lon: number, lat: number): [number, number] {
  return [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
}

// Deterministic pseudo-geo from an id (P1 has no MaxMind geo yet).
function pseudoGeo(id: string): { lat: number; lon: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const lat = ((h % 12000) / 100) - 60;
  const lon = (((h >> 8) % 34000) / 100) - 170;
  return { lat, lon };
}

function geoToPath(geom: Geom): string {
  let d = '';
  const rings = (coords: number[][][]) => {
    for (const ring of coords) {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      });
      d += 'Z';
    }
  };
  if (geom.type === 'Polygon') rings(geom.coordinates as number[][][]);
  else if (geom.type === 'MultiPolygon')
    for (const poly of geom.coordinates as number[][][][]) rings(poly);
  return d;
}

export function WorldMap({ assets }: { assets: Array<Record<string, unknown>> }) {
  const countries = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topo = worldTopo as any;
    const fc = feature(topo, topo.objects.countries) as unknown as {
      features: Array<{ geometry: Geom }>;
    };
    return fc.features.map((f) => geoToPath(f.geometry));
  }, []);

  const points = useMemo(
    () =>
      assets.slice(0, 400).map((a) => {
        const g = pseudoGeo(String(a.id));
        const [x, y] = project(g.lon, g.lat);
        const confirmed = a.state === 'confirmed';
        const crit = String(a.criticality ?? 'unknown');
        return {
          x,
          y,
          confirmed,
          r: crit === 'crown' ? 4 : crit === 'high' ? 3.2 : 2.6,
          label: `${a.entity_type}: ${a.identity}`,
        };
      }),
    [assets],
  );

  return (
    <div className="panel">
      <h2>世界地図 — 攻撃面の地理分布</h2>
      <div className="worldmap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="攻撃面の世界地図">
          <rect x="0" y="0" width={W} height={H} fill="var(--map-sea)" rx="8" />
          <g className="map-land">
            {countries.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          <g>
            {points.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={p.r + 3} className="pt-halo" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.r}
                  className={p.confirmed ? 'pt-confirmed' : 'pt-estimated'}
                >
                  <title>{p.label}</title>
                </circle>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div className="legend">
        <span><i className="dot-confirmed" />確定帰属（ASN/cert/whois で裏取り）</span>
        <span><i className="dot-estimated" />Geo推測（CDN/クラウドで実体とズレ得る）</span>
      </div>
      <div className="hint">
        IP Geo は CDN/クラウドで実体とズレるため、確定帰属と推測を色分け（誇張しない）。
        MaxMind 連携（P4）で精度が上がります。
      </div>
    </div>
  );
}
