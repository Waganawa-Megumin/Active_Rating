import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import type { Rating } from '../api/client.js';

export function CsfRadar({ rating }: { rating: Rating | null }) {
  const csf = rating?.csf ?? { GV: 0, ID: 0, PR: 0, DE: 0, RS: 0, RC: 0 };
  const data = [
    { fn: 'GV 統治', v: csf.GV },
    { fn: 'ID 識別', v: csf.ID },
    { fn: 'PR 防御', v: csf.PR },
    { fn: 'DE 検知', v: csf.DE },
    { fn: 'RS 対応', v: csf.RS },
    { fn: 'RC 復旧', v: csf.RC },
  ];
  return (
    <div className="panel">
      <h2>NIST CSF 姿勢（機能別）</h2>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="#26303f" />
            <PolarAngleAxis dataKey="fn" tick={{ fill: '#8b99ab', fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="v" stroke="#4aa8ff" fill="#4aa8ff" fillOpacity={0.35} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="hint">ASMは ID/PR/DE に強く寄与、RS 間接、RC 最小（正直に低め）</div>
    </div>
  );
}
