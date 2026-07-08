import type { FpRate } from '../api/client.js';

// 反証モード + FP率KPI (design v0.7 §B-3). P1 shows the FP-rate KPI derived from
// dispute outcomes; the dispute intake flow posts to POST /dispute.
export function DisputePanel({ fp }: { fp: FpRate | null }) {
  const rate = fp ? (fp.fp_rate * 100).toFixed(2) : '0.00';
  return (
    <div className="panel">
      <h2>反証モード / FP率（正確さのKPI）</h2>
      <div className="kpi">
        <div className="k">
          <div className="v" style={{ color: '#37d0a0' }}>
            {rate}%
          </div>
          <div className="l">FP Rate</div>
        </div>
        <div className="k">
          <div className="v">{fp?.total_disputes ?? 0}</div>
          <div className="l">Disputes</div>
        </div>
        <div className="k">
          <div className="v" style={{ color: '#ef5a5a' }}>
            {fp?.retracted ?? 0}
          </div>
          <div className="l">Retracted</div>
        </div>
        <div className="k">
          <div className="v" style={{ color: '#4aa8ff' }}>
            {fp?.upheld ?? 0}
          </div>
          <div className="l">Upheld</div>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 12 }}>
        反証申立て（<span className="mono">POST /dispute</span>）→ 証跡を再検証。依然成立なら維持、
        期限切れ/不成立なら自動撤回してFP率に反映。証跡なき評価は出さない。
      </div>
    </div>
  );
}
