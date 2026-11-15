import { useMemo, useRef, useState } from 'react';
import type { History, Platform } from '../lib/api';
import { money, shortDate, date } from '../lib/format';

const W = 760, H = 280, PAD = { l: 64, r: 16, t: 16, b: 32 };

/** Dependency-free, responsive SVG step chart with hover crosshair and togglable series. */
export function PriceChart({ data, platforms }: { data: History; platforms: Map<string, Platform> }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ids = Object.keys(data.series);

  const view = useMemo(() => {
    const visible = ids.filter((id) => !hidden.has(id));
    let minT = Infinity, maxT = -Infinity, minP = Infinity, maxP = -Infinity;
    for (const id of visible) for (const [t, p] of data.series[id]) {
      if (t < minT) minT = t; if (t > maxT) maxT = t; if (p < minP) minP = p; if (p > maxP) maxP = p;
    }
    if (!isFinite(minT)) return null;
    const padP = Math.max(1, (maxP - minP) * 0.1);
    minP = Math.max(0, minP - padP); maxP += padP;
    const x = (t: number) => PAD.l + ((t - minT) / Math.max(1, maxT - minT)) * (W - PAD.l - PAD.r);
    const y = (p: number) => PAD.t + (1 - (p - minP) / Math.max(1, maxP - minP)) * (H - PAD.t - PAD.b);
    const paths = visible.map((id) => {
      const pts = data.series[id];
      let d = '';
      pts.forEach(([t, p], i) => {
        d += i === 0 ? `M${x(t).toFixed(1)},${y(p).toFixed(1)}` : `H${x(t).toFixed(1)}V${y(p).toFixed(1)}`;
      });
      return { id, d };
    });
    const yTicks = Array.from({ length: 5 }, (_, i) => minP + ((maxP - minP) * i) / 4);
    const xTicks = Array.from({ length: 5 }, (_, i) => minT + ((maxT - minT) * i) / 4);
    return { x, y, paths, yTicks, xTicks, minT, maxT, visible };
  }, [data, hidden, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return <div className="muted center" style={{ padding: 40 }}>No price data for this range.</div>;

  // Price of each series at the hovered time (step function → last point at or before t).
  const hoverT = hoverX === null ? null : view.minT + ((hoverX - PAD.l) / (W - PAD.l - PAD.r)) * (view.maxT - view.minT);
  const hoverVals = hoverT === null ? [] : view.visible.map((id) => {
    const pts = data.series[id];
    let lo = 0, hi = pts.length - 1, ans = pts[0];
    while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m][0] <= hoverT) { ans = pts[m]; lo = m + 1; } else hi = m - 1; }
    return { id, price: ans[1] };
  }).sort((a, b) => a.price - b.price);

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHoverX(px < PAD.l || px > W - PAD.r ? null : px);
  };

  return (
    <div className="chart">
      <div className="chart-legend">
        {ids.map((id) => (
          <button key={id} className={`legend-item${hidden.has(id) ? ' off' : ''}`} style={{ ['--pc' as string]: platforms.get(id)?.color }}
            aria-pressed={!hidden.has(id)}
            onClick={() => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); if (n.size === ids.length) return h; return n; })}>
            <i />{platforms.get(id)?.name || id}
          </button>
        ))}
      </div>
      <div className="chart-wrap">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price history chart" onPointerMove={onMove} onPointerLeave={() => setHoverX(null)}>
          {view.yTicks.map((p) => (
            <g key={p}>
              <line x1={PAD.l} x2={W - PAD.r} y1={view.y(p)} y2={view.y(p)} className="grid-line" />
              <text x={PAD.l - 8} y={view.y(p) + 4} textAnchor="end" className="axis">{money(Math.round(p))}</text>
            </g>
          ))}
          {view.xTicks.map((t) => <text key={t} x={view.x(t)} y={H - 8} textAnchor="middle" className="axis">{shortDate(t)}</text>)}
          {view.paths.map(({ id, d }) => <path key={id} d={d} fill="none" stroke={platforms.get(id)?.color || '#888'} strokeWidth={2} strokeLinejoin="round" />)}
          {hoverX !== null && <line x1={hoverX} x2={hoverX} y1={PAD.t} y2={H - PAD.b} className="crosshair" />}
          {hoverX !== null && hoverVals.map((v) => <circle key={v.id} cx={hoverX} cy={view.y(v.price)} r={4} fill={platforms.get(v.id)?.color} stroke="var(--surface)" strokeWidth={2} />)}
        </svg>
        {hoverX !== null && hoverT !== null && (
          <div className="chart-tip" style={{ left: `${(hoverX / W) * 100}%`, transform: hoverX > W / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
            <div className="xs muted">{date(hoverT)}</div>
            {hoverVals.map((v) => (
              <div key={v.id} className="tip-row"><i style={{ background: platforms.get(v.id)?.color }} />{platforms.get(v.id)?.name}<b>{money(v.price)}</b></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
