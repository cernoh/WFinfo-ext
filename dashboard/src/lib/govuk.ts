/**
 * Serves GOV.UK Frontend assets (CSS, JS, fonts, images) locally.
 *
 * The npm package `govuk-frontend@6.5.0` is not imported by the app, so its
 * files are mirrored on demand from unpkg into a local cache directory:
 *   $XDG_CACHE_HOME/wfinfo-dashboard/govuk-6.5.0   (or ~/.cache on Linux)
 *
 * Env overrides:
 *   WFINFO_GOVUK_DIR    point at an unpacked govuk-frontend dist/govuk
 *                       directory to skip the download entirely (offline).
 *   WFINFO_CACHE_DIR    replace the XDG cache root.
 */

const GOVUK_VERSION = "6.5.0";
const PKG_URL = `https://unpkg.com/govuk-frontend@${GOVUK_VERSION}/dist/govuk/`;

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function cacheDir(): string {
  const override = Deno.env.get("WFINFO_GOVUK_DIR");
  if (override) return override;
  const root = Deno.env.get("WFINFO_CACHE_DIR") ??
    Deno.env.get("XDG_CACHE_HOME") ??
    `${Deno.env.get("HOME") ?? "/tmp"}/.cache`;
  return `${root}/wfinfo-dashboard/govuk-${GOVUK_VERSION}`;
}

function safeClean(pathname: string): string | null {
  const clean = pathname.replace(/^\/govuk\//, "");
  if (clean.length === 0 || clean.includes("..") || clean.includes("\0")) {
    return null;
  }
  return clean;
}

function exists(p: string): boolean {
  try {
    return Deno.statSync(p).isFile;
  } catch {
    return false;
  }
}

const mirrorLock = new Map<string, Promise<void>>();

/** Fetch one asset from unpkg into the local mirror (single-flight). */
async function ensureAsset(clean: string): Promise<void> {
  const dest = `${cacheDir()}/${clean}`;
  if (exists(dest)) return;

  const inflight = mirrorLock.get(dest);
  if (inflight) {
    await inflight;
    return;
  }

  const job = (async () => {
    Deno.mkdirSync(dest.slice(0, dest.lastIndexOf("/")), { recursive: true });
    const resp = await fetch(PKG_URL + clean, {
      headers: { "User-Agent": "WarframeInfoDashboard/0.1" },
    });
    if (!resp.ok) {
      throw new Error(
        `Could not download GOV.UK asset "${clean}" (HTTP ${resp.status}). ` +
          `Run with network access once so assets are cached, or set WFINFO_GOVUK_DIR ` +
          `to an unpacked govuk-frontend dist/govuk directory for offline use.`,
      );
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const tmp = `${dest}.tmp`;
    await Deno.writeFile(tmp, bytes);
    await Deno.rename(tmp, dest);
  })();
  mirrorLock.set(dest, job);
  try {
    await job;
  } finally {
    mirrorLock.delete(dest);
  }
}

/** Warm the assets the page needs immediately (CSS, JS, fonts, icon). */
export async function warmGovuk(): Promise<void> {
  const core = [
    "govuk-frontend.min.css",
    "govuk-frontend.min.js",
    "assets/fonts/light-94a07e06a1-v2.woff2",
    "assets/fonts/bold-b542beb274-v2.woff2",
    "assets/images/favicon.svg",
  ];
  try {
    await Promise.all(core.map(ensureAsset));
  } catch (err) {
    console.warn(`GOV.UK assets not warmed: ${(err as Error).message}`);
  }
}

/** Serve a /govuk/... URL path from the local mirror, downloading as needed. */
export async function govukAsset(
  pathname: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  const clean = safeClean(pathname);
  if (!clean) return null;
  await ensureAsset(clean);
  const full = `${cacheDir()}/${clean}`;
  if (!exists(full)) return null;
  const idx = clean.lastIndexOf(".");
  const ext = idx >= 0 ? clean.slice(idx) : "";
  return {
    bytes: Deno.readFileSync(full),
    type: MIME[ext] ?? "application/octet-stream",
  };
}
