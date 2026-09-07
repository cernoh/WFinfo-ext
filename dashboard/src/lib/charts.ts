/**
 * Small inline-SVG price chart (median and average lines) using the GOV.UK
 * palette. Pure: no network, no DOM — renderer only.
 */

export interface ChartPoint {
  /** "d MMM" style label (en-GB), e.g. "3 Sep". */
  dayLabel: string;
  median: number | null;
  avg: number | null;
}

const MEDIAN = "#1d70b8"; // govuk blue
const AVG = "#d4351c"; // govuk red
const GRID = "#b1b4b6"; // govuk mid grey
const TEXT = "#505a5f"; // govuk secondary text

const W = 820;
const H = 230;
const PAD = { top: 10, right: 10, bottom: 26, left: 44 };

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const tick = mag * m;
    if (v <= tick) return tick;
  }
  return mag * 10;
}

/** Two-line chart of daily median/average platinum over the series. */
export function priceChartSvg(points: ChartPoint[]): string {
  const plot = points.filter((p) => p.median !== null || p.avg !== null);
  const n = plot.length;
  if (n === 0) {
    return '<p class="govuk-body-s wf-muted">No recorded sales in the last 90 days.</p>';
  }
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const values = plot.flatMap((p) => [p.median, p.avg])
    .filter((v): v is number => v !== null);
  const lo = Math.min(0, ...values);
  const hi = niceCeil(Math.max(...values));
  const y = (v: number): number => PAD.top + ih - ((v - lo) / (hi - lo)) * ih;
  const x = (i: number): number =>
    n === 1 ? PAD.left + iw / 2 : PAD.left + (i / (n - 1)) * iw;

  const path = (pick: (p: ChartPoint) => number | null): string =>
    plot
      .map((p, i) => {
        const v = pick(p);
        return v === null
          ? null
          : `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .filter((s): s is string => s !== null)
      .join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = PAD.top + ih * f;
    const val = lo + (hi - lo) * (1 - f);
    return `<line x1="${PAD.left}" y1="${gy.toFixed(1)}" x2="${
      W - PAD.right
    }" y2="${gy.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>
<text x="${PAD.left - 6}" y="${
      (gy + 3).toFixed(1)
    }" text-anchor="end" font-size="11" fill="${TEXT}">${trimNum(val)}</text>`;
  }).join("");

  const labelEvery = Math.max(1, Math.ceil(n / 10));
  const xLabels = plot
    .map((p, i) =>
      i % labelEvery === 0 || i === n - 1
        ? `<text x="${x(i).toFixed(1)}" y="${
          H - 8
        }" text-anchor="middle" font-size="11" fill="${TEXT}">${
          escapeXml(p.dayLabel)
        }</text>`
        : ""
    )
    .join("");

  const medianPath = path((p) => p.median);
  const avgPath = path((p) => p.avg);

  return `<svg class="wf-chart" role="img" aria-label="Daily median and average platinum price over the last 90 days" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" focusable="false">
${gridLines}
${
    medianPath
      ? `<path d="${medianPath}" fill="none" stroke="${MEDIAN}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
      : ""
  }
${
    avgPath
      ? `<path d="${avgPath}" fill="none" stroke="${AVG}" stroke-width="1.5" stroke-dasharray="5 4" stroke-linejoin="round"/>`
      : ""
  }
${xLabels}
</svg>
<div class="govuk-body-s wf-chart-key">
  <span class="wf-key wf-key--median"></span> Median &nbsp;
  <span class="wf-key wf-key--avg"></span> Average
</div>`;
}

function trimNum(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(r);
}

function escapeXml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  );
}
