/**
 * Scan-record parsing. The Linux OCR scanner (`WFInfo.Headless --scan`,
 * flake app `.#scan`) writes one JSON record per scan into
 * `<app dir>/scans/latest.json`; this module parses that record for the
 * dashboard (see the repo scan-result contract, which is frozen).
 *
 * Parsing is tolerant on purpose: keys may be missing or extra, prices may
 * arrive as numbers or strings, and a scan that found no reward screen still
 * yields a valid record with an empty choice list.
 */

export interface ScanChoice {
  /** 1-based screen position, left to right. */
  index: number;
  /** Market display name (already Levenshtein-corrected by the scanner). */
  part: string;
  /** warframe.market url_name, null when the part is not in the market DB. */
  slug: string | null;
  plat: number | null;
  /** "wfm" | "cache" | "sheet" | "none" as written by the scanner. */
  platSource: string | null;
  platFetchedAt: string | null;
  volume: number | null;
  ducats: number | null;
  /** True on the highest-platinum choice (same tie rules as `best`). */
  best: boolean;
}

export interface ScanBest {
  index: number;
  part: string;
  plat: number | null;
}

export interface ScanBestDucats {
  index: number;
  part: string;
  ducats: number | null;
}

export interface ScanPriceCache {
  hits: number;
  fetched: number;
  failed: number;
  entries: number;
}

export interface ScanResult {
  version: number;
  startedMs: number;
  finishedMs: number | null;
  durationMs: number | null;
  /** "grim" (screen capture) or "file" (--file <png>). */
  captureSource: string | null;
  /** The grim output name, or the input file path. */
  captureTarget: string | null;
  screenshotPath: string | null;
  screenshotWidth: number | null;
  screenshotHeight: number | null;
  uiScaling: number | null;
  choices: ScanChoice[];
  best: ScanBest | null;
  bestDucats: ScanBestDucats | null;
  priceCache: ScanPriceCache;
  error: string | null;
}

function get(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Numbers may arrive as JSON strings; keep the parsed value either way. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseChoice(raw: unknown, fallbackIndex: number): ScanChoice | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  return {
    index: num(get(o, "Index")) ?? fallbackIndex,
    part: str(get(o, "Part")) ?? "Unknown part",
    slug: str(get(o, "Slug")),
    plat: num(get(o, "Plat")),
    platSource: str(get(o, "PlatSource")),
    platFetchedAt: str(get(o, "PlatFetchedAt")),
    volume: num(get(o, "Volume")),
    ducats: num(get(o, "Ducats")),
    best: get(o, "Best") === true,
  };
}

function parseBest(raw: unknown): ScanBest | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  return {
    index: num(get(o, "Index")) ?? 0,
    part: str(get(o, "Part")) ?? "Unknown part",
    plat: num(get(o, "Plat")),
  };
}

function parseBestDucats(raw: unknown): ScanBestDucats | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  return {
    index: num(get(o, "Index")) ?? 0,
    part: str(get(o, "Part")) ?? "Unknown part",
    ducats: num(get(o, "Ducats")),
  };
}

function parsePriceCache(raw: unknown): ScanPriceCache {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { hits: 0, fetched: 0, failed: 0, entries: 0 };
  }
  const o = raw as Record<string, unknown>;
  return {
    hits: num(get(o, "Hits")) ?? 0,
    fetched: num(get(o, "Fetched")) ?? 0,
    failed: num(get(o, "Failed")) ?? 0,
    entries: num(get(o, "Entries")) ?? 0,
  };
}

/** Epoch ms from an ISO-8601 timestamp string (or numeric ms); NaN otherwise. */
function parseMs(v: unknown): number {
  if (typeof v === "string" && v.length > 0) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : NaN;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return NaN;
}

/** Parse a scan record, or null when the file does not hold an object. */
export function parseScanResult(raw: unknown): ScanResult | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const startedMs = parseMs(get(o, "StartedAt"));
  const finishedMs = parseMs(get(o, "FinishedAt"));
  const choicesRaw = get(o, "Choices");
  const choices: ScanChoice[] = Array.isArray(choicesRaw)
    ? choicesRaw.map(parseChoice).filter((c): c is ScanChoice => c !== null)
    : [];
  return {
    version: num(get(o, "Version")) ?? 0,
    startedMs,
    finishedMs,
    durationMs: num(get(o, "DurationMs")),
    captureSource: str(get(o, "CaptureSource")),
    captureTarget: str(get(o, "CaptureTarget")),
    screenshotPath: str(get(o, "ScreenshotPath")),
    screenshotWidth: num(get(o, "ScreenshotWidth")),
    screenshotHeight: num(get(o, "ScreenshotHeight")),
    uiScaling: num(get(o, "UiScaling")),
    choices,
    best: parseBest(get(o, "Best")),
    bestDucats: parseBestDucats(get(o, "BestDucats")),
    priceCache: parsePriceCache(get(o, "PriceCache")),
    error: str(get(o, "Error")),
  };
}

/**
 * Pick the winning choice from `Choices` alone: highest platinum, ties broken
 * by higher ducats, then by the later index (the same rule the scanner and
 * WFInfo's Windows overlay apply). Only choices with a price qualify; null
 * when no choice has a price.
 */
export function resolveBestChoice(choices: ScanChoice[]): ScanChoice | null {
  let winner: ScanChoice | null = null;
  let winnerPlat = 0;
  let winnerDucats = -1;
  for (const c of choices) {
    // Only a positive price qualifies, matching the scanner (ScanRunner).
    if (c.plat === null || c.plat <= 0) continue;
    const d = c.ducats ?? -1;
    const wins = winner === null || c.plat > winnerPlat ||
      (c.plat === winnerPlat &&
        (d > winnerDucats || (d === winnerDucats && c.index > winner.index)));
    if (wins) {
      winner = c;
      winnerPlat = c.plat;
      winnerDucats = d;
    }
  }
  return winner;
}

/**
 * The best choice for display: trust the record's own flags first (the
 * `Best: true` choice, then `Best.Index`), and fall back to recomputing from
 * `Choices` with the contract tie rules when the record omits them.
 */
export function resolveBest(scan: ScanResult): ScanChoice | null {
  let best = scan.choices.find((c) => c.best) ?? null;
  if (best === null && scan.best !== null) {
    best = scan.choices.find((c) => c.index === scan.best!.index) ?? null;
  }
  return best ?? resolveBestChoice(scan.choices);
}
