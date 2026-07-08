import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import type { Rating } from '../api/client.js';

const GRADE_COLOR: Record<string, string> = {
  A: '#37d0a0',
  B: '#7fd04a',
  C: '#e8b339',
  D: '#ef8a5a',
  F: '#ef5a5a',
};

export function RatingGauge({ rating }: { rating: Rating | null }) {
  const score = rating?.score ?? 0;
  const grade = rating?.grade ?? '—';
  const color = GRADE_COLOR[grade] ?? '#6b7684';
  const data = [{ name: 'score', value: score, fill: color }];

  return (
    <div className="panel">
      <h2>Active Rating（総合）</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 180, height: 180, position: 'relative' }}>
          <ResponsiveContainer>
            <RadialBarChart
              innerRadius="72%"
              outerRadius="100%"
              data={data}
              startAngle={220}
              endAngle={-40}
            >
              <PolarAngleAxis type="number" domain={[0, 1000]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={8} background={{ fill: '#1a2230' }} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div className="gauge-score">{score}</div>
            <div className="gauge-grade" style={{ color }}>
              グレード {grade}
            </div>
          </div>
        </div>
        <div>
          <div className="gauge-sub">0–1000 スケール（高いほど健全）</div>
          {rating && (
            <div className="gauge-sub">
              確定資産 {rating.assets.confirmed}/{rating.assets.total} ・ 帰属確度で加重
            </div>
          )}
          {rating?.provisional && (
            <div className="provisional">
              ※ 暫定値（P1）。framework/vector/overall・ダブルLLMはP5で確定
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
