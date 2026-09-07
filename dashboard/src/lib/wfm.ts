/**
 * Live warframe.market statistics (public v1 endpoint, no auth). WFInfo's
 * Data.cs LoadMarketItem uses the same endpoint for its "plat value" figures.
 * Responses are cached in-process for a short TTL.
 */

export interface StatsPoint {
  dayLabel: string;
  median: number | null;
  avg: number | null;
  volume: number;
}

export interface LiveStats {
  ok: boolean;
  error?: string;
  fetchedAt: number;
  points: StatsPoint[];
  latestMedian: number | null;
  latestAvg: number | null;
  totalVolume: number;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; stats: LiveStats }>();

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function dayLabel(iso: string): string {
  // warframe.market datetimes look like "2026-09-06T15:20:18+00:00".
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso.slice(0, 10);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export async function fetchItemStats(slug: string): Promise<LiveStats> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.stats;

  const base: LiveStats = {
    ok: true,
    fetchedAt: Date.now(),
    points: [],
    latestMedian: null,
    latestAvg: null,
    totalVolume: 0,
  };
  try {
    const url = `https://api.warframe.market/v1/items/${
      encodeURIComponent(slug)
    }/statistics`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "WarframeInfoDashboard/0.1 (+https://github.com/cernoh/WFinfo-ext) unofficial companion",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) {
      throw new Error(`warframe.market replied HTTP ${resp.status}`);
    }
    const body = (await resp.json()) as {
      payload?: { statistics_closed?: { "90days"?: unknown[] } };
    };
    const days = body?.payload?.statistics_closed?.["90days"] ?? [];
    const points: StatsPoint[] = [];
    for (const raw of days) {
      if (typeof raw !== "object" || raw === null) continue;
      const o = raw as Record<string, unknown>;
      const median = num(o.median);
      const avg = num(o.avg_price);
      const volume = num(o.volume) ?? 0;
      if (median === null && avg === null) continue;
      const iso = typeof o.datetime === "string" ? o.datetime : "";
      if (!iso) continue;
      points.push({ dayLabel: dayLabel(iso), median, avg, volume });
    }
    points.sort((a, b) => a.dayLabel.localeCompare(b.dayLabel, "en-GB"));
    base.points = points;
    const last = points[points.length - 1];
    base.latestMedian = last?.median ?? null;
    base.latestAvg = last?.avg ?? null;
    base.totalVolume = points.reduce((acc, p) => acc + p.volume, 0);
  } catch (err) {
    base.ok = false;
    base.error = err instanceof Error ? err.message : String(err);
  }
  cache.set(slug, { at: Date.now(), stats: base });
  return base;
}
