/**
 * Warframe Info dashboard — Deno server.
 *
 * Serves GOV.UK-styled pages over WFInfo's local application data:
 *   /logs       — live tail of debug.log
 *   /recent     — reward screens from debug.log + OCR test-suite results
 *   /scan       — newest OCR reward-screen scan and which part to take
 *   POST /scan/run — start a scan and answer with the outcome
 *   /wfmarket   — cached prime-part prices, with live 90-day statistics per item
 *
 * Environment:
 *   PORT                 listen port (default 8000; a busy port is a startup
 *                        error, never a fallback port)
 *   WFINFO_DATA_DIR      mirrors the headless runner: acts as the config root,
 *                        app dir becomes <dir>/WFInfo (default ~/.config/WFInfo)
 *   WFINFO_GOVUK_DIR     unpacked govuk-frontend dist/govuk (offline override)
 *   WFINFO_CACHE_DIR     replace the XDG cache root for govuk assets
 *   WFINFO_SCAN_CMD      shell command that runs one reward-screen scan
 *                        (default: the flake's scan app, nix run
 *                        <checkout>#scan -- --no-notify)
 *   WFINFO_SCAN_ROOT     checkout the default command builds the runner from
 *   WFINFO_SCAN_REMOTE   set to 1 to accept scan requests from another host
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
  scanBodyHtml,
  type ScanChoiceView,
  scanPageHtml,
  type ScanPageState,
  type ScanView,
  type TokenView,
  wfmarketPageHtml,
} from "./lib/view.ts";
import { parseScanResult, resolveBest, type ScanResult } from "./lib/scan.ts";
import { Scanner } from "./lib/scanner.ts";
import {
  denoRunner,
  discoverTargets,
  resolveCapture,
  type ScanTargets,
  toOptions,
} from "./lib/targets.ts";

const PORT = Number(Deno.env.get("PORT") ?? "8000");
const APP_DIR = resolveAppDir(Deno.env.toObject());
const DEBUG_LOG = `${APP_DIR}/debug.log`;
const RUNS_DIR = `${APP_DIR}/ocr_runs`;
const SCAN_FILE = `${APP_DIR}/scans/latest.json`;
const SCAN_SHOT = `${APP_DIR}/scans/last.png`;
const MARKET_ITEMS = `${APP_DIR}/market_items.json`;
const MARKET_DATA = `${APP_DIR}/market_data.json`;
const TAIL_BYTES = 512 * 1024;

/** A scan run is the headless runner; the page triggers it through this command. */
const REPO_ROOT = decodeURIComponent(
  new URL("../../", import.meta.url).pathname,
).replace(/\/+$/, "");

/** The runner must be built from a writable checkout, never a store copy. */
const HEADLESS_PROJECT = "headless/WFInfo.Headless.csproj";

function isCheckout(root: string): boolean {
  if (root.startsWith("/nix/store/")) return false;
  try {
    return Deno.statSync(`${root}/${HEADLESS_PROJECT}`).isFile;
  } catch {
    return false;
  }
}

/**
 * The default is the flake's scan app: `nix run <root>#scan` builds the runner
 * from `WFINFO_SCAN_ROOT` (else its working directory) and captures the screen.
 * The root is pinned to a checkout that holds the runner, so the dashboard
 * works from any directory and from the packaged `.#dashboard` app, whose own
 * copy lives in the read-only store. Without a checkout the app reports its
 * own "no headless/WFInfo.Headless.csproj" error; set WFINFO_SCAN_CMD to run
 * the scan another way.
 */
const scanRoot = [Deno.cwd(), REPO_ROOT].find(isCheckout);
const flakeRoot = scanRoot ?? REPO_ROOT;
const scanCommand = (Deno.env.get("WFINFO_SCAN_CMD") ?? "").trim() ||
  `${scanRoot ? `WFINFO_SCAN_ROOT='${quote(scanRoot)}' ` : ""}` +
    `nix run '${quote(flakeRoot)}'#scan -- --no-notify`;

function quote(path: string): string {
  return path.replaceAll("'", "'\\''");
}

const scanner = new Scanner({ command: scanCommand });
const SCAN_REMOTE = ["1", "true", "yes"].includes(
  (Deno.env.get("WFINFO_SCAN_REMOTE") ?? "").trim().toLowerCase(),
);

/**
 * Capture targets of this host. Discovery shells out to `wlr-randr` and the
 * compositor, so a short memo keeps a page load and its follow-up request from
 * asking twice; the Refresh button forces a fresh list.
 */
const TARGETS_TTL_MS = 3000;
let targetCache: { at: number; targets: ScanTargets } | null = null;

/**
 * True from the moment a scan request claims the slot until its run ends.
 * `Scanner.busy` alone is not enough: a request reads the form and the target
 * list before it starts the process, and a second request must not slip in
 * during that window.
 */
let scanStarting = false;

async function captureTargets(force = false): Promise<ScanTargets> {
  const now = Date.now();
  if (!force && targetCache !== null && now - targetCache.at < TARGETS_TTL_MS) {
    return targetCache.targets;
  }
  const targets = await discoverTargets(denoRunner());
  targetCache = { at: now, targets };
  return targets;
}

const html = (body: string): Response =>
  new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
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

function scanState(): ScanPageState {
  const scan = parseScanResult(parseJson(SCAN_FILE));
  return {
    appDir: APP_DIR,
    scan: scan === null ? null : toScanView(scan, fileExists(SCAN_SHOT)),
    generatedMs: Date.now(),
  };
}

/** Map the parsed record onto the view model the /scan page renders. */
function toScanView(scan: ScanResult, screenshot: boolean): ScanView {
  const best = resolveBest(scan);
  const bestAt = best === null ? -1 : scan.choices.indexOf(best);
  const choices: ScanChoiceView[] = scan.choices.map((c, i) => ({
    index: c.index,
    part: c.part,
    slug: c.slug,
    plat: c.plat,
    platSource: c.platSource,
    volume: c.volume,
    ducats: c.ducats,
    best: c.best || i === bestAt,
  }));
  return {
    startedMs: Number.isFinite(scan.startedMs) ? scan.startedMs : null,
    finishedMs: scan.finishedMs,
    durationMs: scan.durationMs,
    captureSource: scan.captureSource,
    captureTarget: scan.captureTarget,
    screenshot,
    choices,
    best: bestAt >= 0 ? choices[bestAt] : null,
    priceCache: scan.priceCache,
    error: scan.error,
  };
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

function apiScan(): Response {
  return json({
    updatedAt: fileMtime(SCAN_FILE) ?? Date.now(),
    body: scanBodyHtml(scanState()),
  });
}

/** The scan page's display/window lists; `?refresh=1` skips the short memo. */
async function apiScanTargets(url: URL): Promise<Response> {
  const targets = await captureTargets(url.searchParams.get("refresh") === "1");
  return json(toOptions(targets));
}

/* ------------------------------------------------------------------ */
/* Scan runs (POST /scan/run)                                          */
/* ------------------------------------------------------------------ */

/**
 * Start one reward-screen scan and report what happened. The dashboard has no
 * authentication, so a scan is accepted only from the same origin (no
 * cross-site post) and, unless WFINFO_SCAN_REMOTE is set, only from the
 * machine the dashboard runs on — that machine is the one a scan captures.
 */
async function scanRun(
  req: Request,
  info?: Deno.ServeHandlerInfo,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || originHost !== req.headers.get("host")) {
      return json(
        { error: "This request did not come from the dashboard page." },
        403,
      );
    }
  }

  const remote = info?.remoteAddr;
  if (
    !SCAN_REMOTE && remote !== undefined && remote.transport === "tcp" &&
    !(remote.hostname === "::1" || remote.hostname.startsWith("127.") ||
      remote.hostname.startsWith("::ffff:127."))
  ) {
    return json({
      error:
        `A scan captures the screen of the machine that hosts the dashboard, and ${remote.hostname} is another host. Set WFINFO_SCAN_REMOTE=1 to accept scan requests from other hosts.`,
    }, 403);
  }

  // Claim the slot before the first await: reading the form and the target
  // list takes time, and two requests that overlap there must not both start a
  // scan. The reservation is released when the run (or the failure) is done.
  if (scanner.busy || scanStarting) {
    return json({ error: "A scan is already running." }, 409);
  }
  scanStarting = true;

  try {
    // The form carries the chosen display and window. A window is resolved to
    // its current frame here, not in the browser: the choice is an id, the
    // geometry is whatever the compositor reports now.
    const form = await scanFormValues(req);
    const choice = resolveCapture(
      await captureTargets(form.refresh),
      form.display,
      form.window,
    );
    if (!choice.ok) {
      const message = `${choice.error} Scan not started.`;
      if (!wantsJson(req)) return html(errorPageHtml(message));
      return json({ error: message }, 400);
    }

    const outcome = await scanner.run(choice.capture.args);
    const seconds = (outcome.durationMs / 1000).toFixed(1);
    const message = outcome.status === "ok"
      ? `Scan complete in ${seconds} s. Capture: ${choice.capture.label}.`
      : outcome.status === "timeout"
      ? `The scan did not finish within ${
        Math.round(scanner.timeoutMs / 1000)
      } s and was stopped.`
      : outcome.status === "failed"
      ? `The scan command failed (exit code ${outcome.exitCode}).`
      : "The scan command could not be started.";

    // The page script asks for JSON and refreshes the body itself; a plain
    // form post (no script) gets a redirect back to the page, or the failure
    // page.
    if (!wantsJson(req)) {
      return outcome.status === "ok"
        ? redirect("/scan")
        : html(errorPageHtml(`${message} ${outcome.output}`));
    }
    return json(
      { ...outcome, ok: outcome.status === "ok", message },
      outcome.status === "ok" ? 200 : 502,
    );
  } finally {
    scanStarting = false;
  }
}

const wantsJson = (req: Request): boolean =>
  (req.headers.get("accept") ?? "").includes("application/json");

/**
 * Read the scan form's `display` and `window` fields. A POST without a form
 * body (a scripted click, or a plain form with no choice) means "no preference":
 * the runner then tries every output. `refresh` skips the target memo, so a
 * window that just opened is found.
 */
async function scanFormValues(
  req: Request,
): Promise<{ display: string; window: string; refresh: boolean }> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (
    !type.includes("application/x-www-form-urlencoded") &&
    !type.includes("multipart/form-data")
  ) {
    return { display: "", window: "", refresh: false };
  }

  try {
    const data = await req.formData();
    const value = (key: string): string => {
      const raw = data.get(key);
      return typeof raw === "string" ? raw.trim() : "";
    };
    return {
      display: value("display"),
      window: value("window"),
      refresh: value("refresh") !== "",
    };
  } catch {
    return { display: "", window: "", refresh: false };
  }
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

async function handler(
  req: Request,
  info?: Deno.ServeHandlerInfo,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    if (path === "/scan/run") return await scanRun(req, info);

    if (req.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }

    if (path === "/") return redirect("/logs");

    if (path === "/logs") return html(logsPageHtml(logsState()));

    if (path === "/recent") return html(recentPageHtml(recentState()));

    if (path === "/scan") {
      return html(scanPageHtml(scanState(), toOptions(await captureTargets())));
    }

    if (path === "/scan/screenshot") {
      // Only the fixed screenshot path is ever served: the route is an exact
      // match and the file name is a compile-time constant, so no request
      // input reaches the filesystem path.
      try {
        const bytes = Deno.readFileSync(SCAN_SHOT);
        return new Response(bytes, {
          headers: {
            "content-type": "image/png",
            "cache-control": "no-store",
          },
        });
      } catch {
        return new Response("scan screenshot not found", { status: 404 });
      }
    }

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
    if (path === "/api/scan") return apiScan();
    if (path === "/api/scan/targets") return await apiScanTargets(url);

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
  await warmGovuk();
  try {
    // A bind failure (the port belongs to another process) is thrown here, so
    // this is where the operator gets told which port is taken. Deno prints
    // its own "Listening on …" line after a successful bind.
    Deno.serve({ port: PORT }, handler);
  } catch (err) {
    if (err instanceof Deno.errors.AddrInUse) {
      console.error(`error: port ${PORT} is already in use`);
      console.error(
        `  stop the process that holds it, or listen elsewhere: PORT=8765 deno task dev`,
      );
      Deno.exit(1);
    }
    throw err;
  }
}

export { handler };
