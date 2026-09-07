/**
 * Warframe Info dashboard — Deno server.
 *
 * Serves GOV.UK-styled pages over WFInfo's local application data:
 *   /logs       — live tail of debug.log
 *   /recent     — reward screens from debug.log + OCR test-suite results
 *   /wfmarket   — cached prime-part prices, with live 90-day statistics per item
 *
 * Environment:
 *   PORT                 listen port (default 8000)
 *   WFINFO_DATA_DIR      mirrors the headless runner: acts as the config root,
 *                        app dir becomes <dir>/WFInfo (default ~/.config/WFInfo)
 *   WFINFO_GOVUK_DIR     unpacked govuk-frontend dist/govuk (offline override)
 *   WFINFO_CACHE_DIR     replace the XDG cache root for govuk assets
 *
 * No runtime dependencies beyond the Deno standard library.
 */

import {
  parseLogLines,
  parseSuiteResult,
  resolveAppDir,
  type RunRecord,
  tailLines,
} from "./lib/fsdata.ts";
import {
  type CatalogItem,
  indexMarket,
  lookupPrice,
  type MarketIndex,
  pricedCatalog,
  slugForName,
} from "./lib/items.ts";
import { extractRewardEvents, type RewardLogEvent } from "./lib/recent.ts";
import { govukAsset, warmGovuk } from "./lib/govuk.ts";
import { fetchItemStats, type LiveStats } from "./lib/wfm.ts";
import {
  errorPageHtml,
  itemPageHtml,
  logsPageHtml,
  notFoundPageHtml,
  recentPageHtml,
  type RecentState,
  type RewardView,
  type RunScenarioView,
  type RunView,
  type TokenView,
  wfmarketPageHtml,
} from "./lib/view.ts";

const PORT = Number(Deno.env.get("PORT") ?? "8000");
const APP_DIR = resolveAppDir(Deno.env.toObject());
const DEBUG_LOG = `${APP_DIR}/debug.log`;
const RUNS_DIR = `${APP_DIR}/ocr_runs`;
const MARKET_ITEMS = `${APP_DIR}/market_items.json`;
const MARKET_DATA = `${APP_DIR}/market_data.json`;
const TAIL_BYTES = 512 * 1024;

const html = (body: string): Response =>
  new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const redirect = (to: string): Response =>
  new Response(null, { status: 302, headers: { location: to } });

/* ------------------------------------------------------------------ */
/* File helpers                                                        */
/* ------------------------------------------------------------------ */

function fileExists(p: string): boolean {
  try {
    return Deno.statSync(p).isFile;
  } catch {
    return false;
  }
}

function dirExists(p: string): boolean {
  try {
    return Deno.statSync(p).isDirectory;
  } catch {
    return false;
  }
}

function fileMtime(p: string): number | null {
  try {
    return Math.floor(Deno.statSync(p).mtime?.getTime() ?? NaN);
  } catch {
    return null;
  }
}

function readText(p: string): string | null {
  try {
    return Deno.readTextFileSync(p);
  } catch {
    return null;
  }
}

function readTail(p: string, maxBytes: number): string | null {
  try {
    const stat = Deno.statSync(p);
    if (stat.size <= maxBytes) return Deno.readTextFileSync(p);
    const f = Deno.openSync(p, { read: true });
    try {
      f.seekSync(-maxBytes, Deno.SeekMode.End);
      const buf = new Uint8Array(maxBytes);
      const n = f.readSync(buf);
      return new TextDecoder().decode(buf.subarray(0, n ?? 0));
    } finally {
      f.close();
    }
  } catch {
    return null;
  }
}

function parseJson(p: string): unknown | null {
  const text = readText(p);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readDebugEntries(): {
  entries: ReturnType<typeof parseLogLines>;
  anchorMs: number;
} {
  const text = readTail(DEBUG_LOG, TAIL_BYTES) ?? "";
  const anchorMs = fileMtime(DEBUG_LOG) ?? Date.now();
  return { entries: parseLogLines(text, anchorMs), anchorMs };
}

function listRunRecords(): RunRecord[] {
  if (!dirExists(RUNS_DIR)) return [];
  let names: string[] = [];
  try {
    names = [...Deno.readDirSync(RUNS_DIR)]
      .filter((e) => e.isFile && e.name.toLowerCase().endsWith(".json"))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const records: RunRecord[] = [];
  const byMtime = names
    .map((name) => ({ name, ms: fileMtime(`${RUNS_DIR}/${name}`) ?? 0 }))
    .sort((a, b) => b.ms - a.ms);
  for (const { name } of byMtime) {
    const record = parseSuiteResult(parseJson(`${RUNS_DIR}/${name}`), name);
    if (record === null) continue;
    const key = `${record.suite}|${record.startedMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(record);
    if (records.length >= 8) break;
  }
  return records;
}

/* ------------------------------------------------------------------ */
/* Market catalogue (short-lived memo)                                 */
/* ------------------------------------------------------------------ */

interface CatalogSnapshot {
  at: number;
  index: MarketIndex;
  items: CatalogItem[];
  dbPresent: boolean;
}

let catalog: CatalogSnapshot | null = null;
const CATALOG_TTL_MS = 60 * 1000;

function snapshotCatalog(): CatalogSnapshot {
  const now = Date.now();
  if (catalog && now - catalog.at < CATALOG_TTL_MS) return catalog;
  const dbPresent = fileExists(MARKET_ITEMS) || fileExists(MARKET_DATA);
  const rawItems = parseJson(MARKET_ITEMS);
  const rawData = parseJson(MARKET_DATA);
  const index = indexMarket(rawItems, rawData);
  catalog = { at: now, index, items: pricedCatalog(index), dbPresent };
  return catalog;
}

function toTokenView(name: string, index: MarketIndex): TokenView {
  const price = lookupPrice(index, name);
  return {
    name,
    slug: slugForName(index, name),
    plat: price?.plat ?? null,
    ducats: price?.ducats ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Page state builders                                                 */
/* ------------------------------------------------------------------ */

function logsState(): Parameters<typeof logsPageHtml>[0] {
  const { entries } = readDebugEntries();
  const total = entries.length;
  const text = readTail(DEBUG_LOG, TAIL_BYTES) ?? "";
  const newestFirst = tailLines(text, 400);
  const updatedAtMs = fileMtime(DEBUG_LOG) ?? Date.now();
  return {
    lines: newestFirst,
    shown: newestFirst.length,
    total,
    updatedAtMs,
    appDir: APP_DIR,
  };
}

function recentState(): RecentState {
  const { entries } = readDebugEntries();
  const index = snapshotCatalog().index;

  const events: RewardLogEvent[] = extractRewardEvents(entries).reverse();
  const rewards: RewardView[] = events.slice(0, 40).map((e) => ({
    ts: e.ts,
    tsText: e.tsText,
    chosen: e.chosen,
    rewards: e.rewards.map((name) => toTokenView(name, index)),
  }));

  const runs: RunView[] = listRunRecords().map((r) => {
    const scenarios: RunScenarioView[] = r.scenarios.map((s) => ({
      name: s.name,
      success: s.success,
      accuracy: s.accuracy,
      parts: s.actualParts.slice(0, 60).map((name) => toTokenView(name, index)),
      missing: s.missingParts,
      extra: s.extraParts,
      errorMessage: s.errorMessage,
    }));
    return {
      fileName: r.fileName,
      suite: r.suite,
      startedMs: r.startedMs,
      total: r.total,
      passed: r.passed,
      failed: r.failed,
      errors: r.errors,
      accuracy: r.accuracy,
      scenarios,
    };
  });

  return {
    appDir: APP_DIR,
    rewards,
    runs,
    generatedMs: Date.now(),
    ocrRunsDirExists: dirExists(RUNS_DIR),
  };
}

function marketState(
  url: URL,
): Parameters<typeof wfmarketPageHtml>[0] {
  const snap = snapshotCatalog();
  const q = (url.searchParams.get("q") ?? "").trim();
  const sortParam = url.searchParams.get("sort") ?? "name";
  const dirParam = url.searchParams.get("dir") === "desc" ? "desc" : "asc";
  const sort = ["name", "plat", "volume", "ducats"].includes(sortParam)
    ? (sortParam as Parameters<typeof wfmarketPageHtml>[0]["sort"])
    : "name";

  let items = snap.items;
  if (q.length > 0) {
    const needle = q.toLowerCase();
    items = items.filter((it) =>
      `${it.name} ${it.fullName} ${it.slug}`.toLowerCase().includes(needle)
    );
  }

  const num = (it: CatalogItem): number => {
    const v = sort === "name" ? 0 : it[sort];
    return v === null ? Number.NEGATIVE_INFINITY : (v as number);
  };
  const byName = (a: CatalogItem, b: CatalogItem): number =>
    a.fullName.localeCompare(b.fullName, "en");
  items = [...items].sort((a, b) => {
    const cmp = sort === "name" ? byName(a, b) : num(a) - num(b);
    if (cmp !== 0) return dirParam === "desc" ? -cmp : cmp;
    return byName(a, b);
  });

  const total = items.length;
  if (url.searchParams.get("all") !== "1" && total > 250) {
    items = items.slice(0, 250);
  }

  return {
    items,
    total,
    q,
    sort,
    dir: dirParam,
    appDir: APP_DIR,
    dbPresent: snap.dbPresent,
  };
}

async function itemDetailState(slug: string): Promise<
  Parameters<typeof itemPageHtml>[0] | null
> {
  const snap = snapshotCatalog();
  const item = snap.items.find((it) => it.slug === slug);
  if (!item) return null;
  const stats: LiveStats = await fetchItemStats(slug);
  return { item, stats, appDir: APP_DIR };
}

/* ------------------------------------------------------------------ */
/* API responses                                                       */
/* ------------------------------------------------------------------ */

function apiLogs(): Response {
  const { entries } = readDebugEntries();
  const text = readTail(DEBUG_LOG, TAIL_BYTES) ?? "";
  return json({
    updatedAt: fileMtime(DEBUG_LOG) ?? Date.now(),
    total: entries.length,
    lines: tailLines(text, 400),
  });
}

function apiRewardEvents(): Response {
  const { entries } = readDebugEntries();
  const index = snapshotCatalog().index;
  const rewards: RewardView[] = extractRewardEvents(entries).reverse()
    .slice(0, 40)
    .map((e) => ({
      ts: e.ts,
      tsText: e.tsText,
      chosen: e.chosen,
      rewards: e.rewards.map((name) => toTokenView(name, index)),
    }));
  return json({ rewards });
}

function apiOcrRuns(): Response {
  const index = snapshotCatalog().index;
  const runs: RunView[] = listRunRecords().map((r) => ({
    fileName: r.fileName,
    suite: r.suite,
    startedMs: r.startedMs,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    errors: r.errors,
    accuracy: r.accuracy,
    scenarios: r.scenarios.map((s) => ({
      name: s.name,
      success: s.success,
      accuracy: s.accuracy,
      parts: s.actualParts.slice(0, 60).map((name) => toTokenView(name, index)),
      missing: s.missingParts,
      extra: s.extraParts,
      errorMessage: s.errorMessage,
    })),
  }));
  return json({ runs });
}

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

const STATIC_ROOT = new URL("./static/", import.meta.url);
const STATIC_MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serveStatic(pathname: string): Response | null {
  const name = pathname.replace(/^\/assets\//, "");
  if (name.length === 0 || name.includes("..") || name.includes("\0")) {
    return null;
  }
  const full = new URL(name, STATIC_ROOT);
  try {
    const bytes = Deno.readFileSync(full);
    const idx = name.lastIndexOf(".");
    const type = STATIC_MIME[idx >= 0 ? name.slice(idx) : ""] ??
      "application/octet-stream";
    return new Response(bytes, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    if (path === "/") return redirect("/logs");

    if (path === "/logs") return html(logsPageHtml(logsState()));

    if (path === "/recent") return html(recentPageHtml(recentState()));

    if (path === "/wfmarket") return html(wfmarketPageHtml(marketState(url)));

    if (path.startsWith("/wfmarket/")) {
      const slug = decodeURIComponent(path.slice("/wfmarket/".length));
      const state = await itemDetailState(slug);
      if (state === null) return html(notFoundPageHtml());
      return html(itemPageHtml(state));
    }

    if (path === "/api/logs") return apiLogs();
    if (path === "/api/reward-events") return apiRewardEvents();
    if (path === "/api/ocr-runs") return apiOcrRuns();

    if (path.startsWith("/govuk/")) {
      const asset = await govukAsset(path);
      if (asset === null) return html(notFoundPageHtml());
      return new Response(asset.bytes, {
        headers: {
          "content-type": asset.type,
          "cache-control": "public, max-age=86400",
        },
      });
    }

    if (path.startsWith("/assets/")) {
      const asset = serveStatic(path);
      if (asset === null) return html(notFoundPageHtml());
      return asset;
    }

    return html(notFoundPageHtml());
  } catch (err) {
    console.error(
      `request failed: ${path} — ${err instanceof Error ? err.message : err}`,
    );
    return html(errorPageHtml("The server could not complete the request."));
  }
}

if (import.meta.main) {
  console.log(`Warframe Info dashboard`);
  console.log(`  data dir:  ${APP_DIR}`);
  console.log(`  listening: http://localhost:${PORT}`);
  await warmGovuk();
  Deno.serve({ port: PORT }, handler);
}

export { handler };
