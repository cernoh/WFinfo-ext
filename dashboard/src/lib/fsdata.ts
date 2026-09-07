/**
 * Application-data access: mirrors how the .NET core resolves its data root,
 * plus text helpers for tailing WFInfo's debug.log.
 *
 * The .NET headless runner treats WFINFO_DATA_DIR as an XDG_CONFIG_HOME
 * override (see headless/Program.cs ConfigureEnvironment), so the app dir is
 * `<override>/WFInfo`; on Windows it is `%APPDATA%\WFInfo`. All file paths use
 * the OS separator; on Linux that is "/" and on Windows the .NET app writes
 * backslash paths that Deno normalizes.
 */

export interface LogEntry {
  /** Best-effort UTC epoch ms from the leading "[dd/MM/yyyy HH:mm:ss]" (or null). */
  ts: number | null;
  /** The raw bracket prefix as written, e.g. "[07/09/2026 21:09:12]". */
  tsText: string;
  /** Log line content after the timestamp prefix. */
  message: string;
}

/** Resolve the WFInfo application-data directory from the environment. */
export function resolveAppDir(
  env: Record<string, string | undefined>,
): string {
  const appData = env.APPDATA;
  // Forward slashes are accepted by Deno on Windows too, so one join rule
  // works on every platform (the .NET app uses backslashes; stat/read accept
  // both, and Deno normalizes on write).
  if (appData) return `${appData}/WFInfo`;
  const configRoot = env.WFINFO_DATA_DIR ??
    env.XDG_CONFIG_HOME ??
    `${env.HOME ?? "/tmp"}/.config`;
  return `${configRoot}/WFInfo`;
}

const TS_RE =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s*(AM|PM))?\]\s*(.*)$/i;

function buildCandidate(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Reject impossible dates like 31/02 by round-trip.
  if (
    dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt.getTime();
}

/**
 * Parse the timestamp prefix of a .NET "general date/time" log line. .NET
 * renders it with the machine culture, so it may be dd/MM/yyyy or MM/dd/yyyy
 * (and either 12h or 24h). When the day and month are both <= 12, pick the
 * interpretation closest to `anchorMs` (usually the log file's mtime).
 */
export function parseLogTimestamp(
  text: string,
  anchorMs: number,
): { ts: number | null; rest: string } {
  const m = TS_RE.exec(text);
  if (!m) return { ts: null, rest: text };
  const [, dRaw, moRaw, yRaw, hRaw, miRaw, sRaw, ampm] = m;
  const d = Number(dRaw);
  const mo = Number(moRaw);
  const y = Number(yRaw);
  let h = Number(hRaw);
  if (/pm/i.test(ampm ?? "") && h < 12) h += 12;
  if (/am/i.test(ampm ?? "") && h === 12) h = 0;
  const cands: number[] = [];
  const a = buildCandidate(y, mo, d, h, Number(miRaw), Number(sRaw));
  const b = buildCandidate(y, d, mo, h, Number(miRaw), Number(sRaw));
  if (a !== null) cands.push(a);
  if (b !== null && b !== a) cands.push(b);
  if (cands.length === 0) return { ts: null, rest: m[8] ?? "" };
  cands.sort((x, y2) => Math.abs(x - anchorMs) - Math.abs(y2 - anchorMs));
  return { ts: cands[0], rest: m[8] ?? "" };
}

/** Split log text into entries in file order, tolerating a trailing partial line. */
export function parseLogLines(
  text: string,
  anchorMs: number,
): LogEntry[] {
  const lines = text.split("\n");
  const out: LogEntry[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.length === 0) continue;
    const { ts, rest } = parseLogTimestamp(line, anchorMs);
    out.push({
      ts,
      tsText: ts !== null && line.startsWith("[")
        ? line.slice(0, line.indexOf("]") + 1)
        : "",
      message: rest,
    });
  }
  return out;
}

/** Keep the last `maxLines` complete lines of log text, newest first. */
export function tailLines(text: string, maxLines: number): string[] {
  const lines = text.split("\n");
  // Drop the final split artifact: it is either "" (text ended with a newline)
  // or an unterminated fragment (the app may be mid-append).
  if (lines.length > 0) lines.pop();
  const kept = lines.slice(-maxLines);
  kept.reverse();
  return kept;
}

/** A parsed OCR suite result (serialized WFInfo.Tests.TestSuiteResult). */
export interface ScenarioRecord {
  name: string;
  success: boolean;
  accuracy: number;
  actualParts: string[];
  missingParts: string[];
  extraParts: string[];
  errorMessage: string | null;
  processingMs: number;
}

export interface RunRecord {
  fileName: string;
  suite: string;
  startedMs: number;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  accuracy: number;
  errorMessage: string | null;
  scenarios: ScenarioRecord[];
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

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse a suite-result JSON object, tolerating PascalCase and camelCase keys. */
export function parseSuiteResult(
  raw: unknown,
  fileName: string,
): RunRecord | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const suite = str(get(o, "TestSuiteName", "testSuiteName"));
  if (suite === null) return null;
  const startedRaw = get(o, "StartTime", "startTime");
  const startedMs = typeof startedRaw === "string"
    ? Date.parse(startedRaw)
    : typeof startedRaw === "number"
    ? startedRaw
    : NaN;
  const scenariosArr = get(o, "TestResults", "testResults");
  const scenarios: ScenarioRecord[] = Array.isArray(scenariosArr)
    ? scenariosArr.map((sRaw): ScenarioRecord | null => {
      if (typeof sRaw !== "object" || sRaw === null) return null;
      const s = sRaw as Record<string, unknown>;
      const name = str(get(s, "TestCaseName", "testCaseName"));
      if (name === null) return null;
      const arr = (v: unknown): string[] =>
        Array.isArray(v) ? v.map((x) => String(x)) : [];
      return {
        name,
        success: get(s, "Success", "success") === true,
        accuracy: num(get(s, "AccuracyScore", "accuracyScore")) ?? 0,
        actualParts: arr(get(s, "ActualParts", "actualParts")),
        missingParts: arr(get(s, "MissingParts", "missingParts")),
        extraParts: arr(get(s, "ExtraParts", "extraParts")),
        errorMessage: str(get(s, "ErrorMessage", "errorMessage")),
        processingMs: num(get(s, "ProcessingTimeMs", "processingTimeMs")) ?? 0,
      };
    }).filter((x): x is ScenarioRecord => x !== null)
    : [];
  return {
    fileName,
    suite,
    startedMs: Number.isFinite(startedMs) ? startedMs : NaN,
    total: num(get(o, "TotalTests", "totalTests")) ?? scenarios.length,
    passed: num(get(o, "PassedTests", "passedTests")) ?? 0,
    failed: num(get(o, "FailedTests", "failedTests")) ?? 0,
    errors: num(get(o, "ErrorTests", "errorTests")) ?? 0,
    accuracy: num(get(o, "OverallAccuracy", "overallAccuracy")) ?? 0,
    errorMessage: str(get(o, "ErrorMessage", "errorMessage")),
    scenarios,
  };
}
