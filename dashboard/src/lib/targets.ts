/**
 * Capture targets for a dashboard-triggered scan.
 *
 * One scan captures exactly one image: a whole output (`grim -o <name>`), or a
 * layout region (`grim -g "X,Y WxH"`) — the way one window is captured. This
 * module discovers what the host that runs the scan can capture (displays and
 * windows) and turns a choice into the runner's `--output`/`--region` argument.
 *
 * Sources, each optional — a missing tool shortens the list, it never blocks a
 * scan:
 *   `wlr-randr --json`     outputs: name, size, layout position (wlroots)
 *   `mmsg get all-clients` windows with geometry (mango IPC; Wayland has no
 *                          portable window-geometry protocol)
 *   `wlrctl toplevel list` window names only (any wlr-foreign-toplevel host)
 *
 * Window geometry is read from the compositor in layout coordinates — the same
 * space as `grim -g` and as the monitor positions — so a client rectangle is a
 * valid capture region as-is.
 */

/** Result of one command; `code` is null when the command could not start. */
export interface CommandOutput {
  code: number | null;
  stdout: string;
}

/** Runs the compositor tools. Injectable so the tests stay offline. */
export interface CommandRunner {
  run(file: string, args: string[], timeoutMs: number): Promise<CommandOutput>;
}

/** A grim capture source: `-o` output name, or `-g` region of a window. */
export interface DisplayTarget {
  /** Output name as `grim -o` and `wlr-randr` spell it, e.g. "DP-2". */
  name: string;
  model: string | null;
  width: number | null;
  height: number | null;
  x: number | null;
  y: number | null;
}

export interface WindowTarget {
  /** Compositor client id, as text (mango reports a number). */
  id: string;
  appId: string;
  title: string;
  /** Output name the compositor places the window on, when it reports one. */
  monitor: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
}

export interface ScanTargets {
  displays: DisplayTarget[];
  windows: WindowTarget[];
  /** Why a list is short: a missing tool, or an answer that did not parse. */
  notes: string[];
}

/** Select entry for the scan page. */
export interface TargetOption {
  value: string;
  label: string;
}

export interface ScanTargetOptions {
  displays: TargetOption[];
  windows: TargetOption[];
  notes: string[];
}

/** A capture choice: one display, or one window's rectangle. */
export type CaptureRequest =
  | { kind: "display"; name: string }
  | { kind: "window"; id: string };

export interface ResolvedCapture {
  /** Runner arguments, e.g. ["--region", "10,44 1900x1026"]. */
  args: string[];
  /** What the scan page shows as the chosen target. */
  label: string;
}

const COMMAND_TIMEOUT_MS = 5000;

/** Display names and window ids the dashboard is willing to accept. */
const DISPLAY_NAME = /^[A-Za-z0-9._+-]{1,64}$/;
const WINDOW_ID = /^\d{1,12}$/;

/* ------------------------------------------------------------------ */
/* Value helpers                                                       */
/* ------------------------------------------------------------------ */

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

export const regionOf = (
  x: number,
  y: number,
  width: number,
  height: number,
): string => `${x},${y} ${width}x${height}`;

export const displayToken = (name: string): string => `display:${name}`;

export const windowToken = (id: string): string => `window:${id}`;

/* ------------------------------------------------------------------ */
/* Parsers (pure: fixtures in, targets out)                            */
/* ------------------------------------------------------------------ */

/**
 * `wlr-randr --json`: enabled outputs with their current mode and position.
 * `position` and `scale` describe the same layout space `grim -g` uses.
 */
export function parseRandrDisplays(raw: unknown): DisplayTarget[] {
  if (!Array.isArray(raw)) return [];
  const displays: DisplayTarget[] = [];
  for (const entry of raw) {
    const out = record(entry);
    if (out === null) continue;
    if (out.enabled === false) continue;
    const name = str(out.name);
    if (name === null) continue;

    const modes = Array.isArray(out.modes) ? out.modes : [];
    let current: Record<string, unknown> | null = null;
    for (const mode of modes) {
      const m = record(mode);
      if (m !== null && m.current === true) {
        current = m;
        break;
      }
    }
    if (current === null) {
      const first = modes.map(record).find((m) => m !== null) ?? null;
      current = first;
    }

    const position = record(out.position);
    displays.push({
      name,
      model: str(out.model) ?? str(out.make),
      width: int(current?.width),
      height: int(current?.height),
      x: int(position?.x),
      y: int(position?.y),
    });
  }
  return displays;
}

/**
 * Plain `wlr-randr` output, for a build without `--json`: an unindented line
 * starts an output ("DP-2 \"HUAWEI AD80HW (DP-2)\""), and "Enabled: no" below
 * it marks the output as off. Size and position are left unknown — the name is
 * all `grim -o` needs.
 */
export function parseRandrTextDisplays(text: string): DisplayTarget[] {
  const displays: DisplayTarget[] = [];
  let current: DisplayTarget | null = null;
  let enabled = true;

  const flush = () => {
    if (current !== null && enabled) displays.push(current);
    current = null;
  };

  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") continue;

    if (!/^\s/.test(line)) {
      flush();
      const name = line.split(/[\s\t]+/)[0];
      if (name !== undefined && name !== "") {
        current = {
          name,
          model: null,
          width: null,
          height: null,
          x: null,
          y: null,
        };
      }
      enabled = true;
      continue;
    }

    const trimmed = line.trim();
    if (/^Enabled:/i.test(trimmed)) enabled = /yes/i.test(trimmed);
  }
  flush();
  return displays;
}

/**
 * `mmsg get all-clients` (mango IPC): every mapped client with its rectangle in
 * layout coordinates. Zero-sized clients (unmapped, minimized) are dropped.
 */
export function parseMangoWindows(raw: unknown): WindowTarget[] {
  const root = record(raw);
  const clients = Array.isArray(root?.clients)
    ? root!.clients as unknown[]
    : [];
  const windows: WindowTarget[] = [];

  for (const entry of clients) {
    const c = record(entry);
    if (c === null) continue;
    if (c.is_visible === false) continue;

    const id = c.id === undefined || c.id === null ? null : String(c.id);
    const x = int(c.x);
    const y = int(c.y);
    const width = int(c.width);
    const height = int(c.height);
    if (id === null || id === "" || x === null || y === null) continue;
    if (width === null || height === null || width <= 0 || height <= 0) {
      continue;
    }

    windows.push({
      id,
      appId: str(c.appid) ?? str(c.app_id) ?? "unknown",
      title: str(c.title) ?? "",
      monitor: str(c.monitor),
      x,
      y,
      width,
      height,
      focused: c.is_focused === true,
    });
  }

  // Focused first, then stable by application and title: the page shows a
  // predictable list even while windows open and close.
  return windows.sort((a, b) =>
    Number(b.focused) - Number(a.focused) ||
    a.appId.localeCompare(b.appId, "en") ||
    a.title.localeCompare(b.title, "en") ||
    a.id.localeCompare(b.id, "en")
  );
}

/**
 * `wlrctl toplevel list`: "appid: title" per window, "toplevels: N" when the
 * list is empty. Names only — no compositor-independent geometry — so these
 * windows cannot be captured as a region.
 */
export function parseToplevelNames(text: string): string[] {
  const names: string[] = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (line === "") continue;
    const at = line.indexOf(": ");
    if (at < 0) continue;
    const title = line.slice(at + 2).trim();
    names.push(
      title === ""
        ? line.slice(0, at).trim()
        : `${line.slice(0, at)} — ${title}`,
    );
  }
  return names;
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

/** " · 1920×1080 at 1920,0" — omitted when the size or position is unknown. */
function sizeLabel(d: DisplayTarget): string {
  if (d.width === null || d.height === null) return "";
  const at = d.x === null || d.y === null || (d.x === 0 && d.y === 0)
    ? ""
    : ` at ${d.x},${d.y}`;
  return ` · ${d.width}×${d.height}${at}`;
}

async function readDisplays(
  runner: CommandRunner,
  notes: string[],
): Promise<DisplayTarget[]> {
  const json = await runner.run("wlr-randr", ["--json"], COMMAND_TIMEOUT_MS);
  if (json.code === 0 && json.stdout.trim() !== "") {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(json.stdout);
    } catch {
      parsed = null;
    }
    const displays = parseRandrDisplays(parsed);
    if (displays.length > 0) return displays;
    notes.push(
      "wlr-randr returned no enabled outputs; the scan then tries every output.",
    );
    return [];
  }

  const plain = await runner.run("wlr-randr", [], COMMAND_TIMEOUT_MS);
  if (plain.code === 0 && plain.stdout.trim() !== "") {
    const displays = parseRandrTextDisplays(plain.stdout);
    if (displays.length > 0) {
      notes.push(
        "wlr-randr could not report output sizes (no --json); display names only.",
      );
      return displays;
    }
  }

  notes.push(
    json.code === null || plain.code === null
      ? "wlr-randr is not on PATH, so the display list is empty; a scan then tries every output."
      : "wlr-randr could not list the displays; a scan then tries every output.",
  );
  return [];
}

async function readWindows(
  runner: CommandRunner,
  notes: string[],
): Promise<WindowTarget[]> {
  const mango = await runner.run(
    "mmsg",
    ["get", "all-clients"],
    COMMAND_TIMEOUT_MS,
  );
  if (mango.code === 0 && mango.stdout.trim() !== "") {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(mango.stdout);
    } catch {
      parsed = null;
    }
    const windows = parseMangoWindows(parsed);
    if (windows.length > 0) return windows;
    notes.push(
      "No mapped windows found; open Warframe and refresh the list to capture its window.",
    );
    return [];
  }

  const toplevels = await runner.run(
    "wlrctl",
    ["toplevel", "list"],
    COMMAND_TIMEOUT_MS,
  );
  const names = toplevels.code === 0
    ? parseToplevelNames(toplevels.stdout)
    : [];

  if (mango.code === null) {
    notes.push(
      names.length === 0
        ? "Window capture needs mango IPC (mmsg), which is not on PATH; the display list above still works."
        : `Window capture needs mango IPC (mmsg), which is not on PATH. Open windows: ${
          names.join("; ")
        }.`,
    );
    return [];
  }

  notes.push(
    names.length === 0
      ? "The compositor did not answer `mmsg get all-clients`, so no window geometry is available; the display list above still works."
      : `The compositor did not answer \`mmsg get all-clients\`, so no window geometry is available. Open windows: ${
        names.join("; ")
      }.`,
  );
  return [];
}

/** Lists what the scan can capture: displays and windows of this host. */
export async function discoverTargets(
  runner: CommandRunner,
): Promise<ScanTargets> {
  const notes: string[] = [];
  const displays = await readDisplays(runner, notes);
  const windows = await readWindows(runner, notes);
  return { displays, windows, notes };
}

/** Runs the compositor tools with a deadline; a slow tool never blocks a page. */
export function denoRunner(): CommandRunner {
  return {
    async run(file, args, timeoutMs) {
      let child: Deno.ChildProcess;
      try {
        child = new Deno.Command(file, {
          args,
          stdin: "null",
          stdout: "piped",
          stderr: "null",
        }).spawn();
      } catch {
        return { code: null, stdout: "" };
      }

      const deadline = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }, timeoutMs);

      try {
        const out = await child.output();
        return {
          code: out.code,
          stdout: new TextDecoder().decode(out.stdout),
        };
      } catch {
        return { code: null, stdout: "" };
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Options and resolution                                              */
/* ------------------------------------------------------------------ */

export function displayLabel(d: DisplayTarget): string {
  return `${d.name}${d.model === null ? "" : ` — ${d.model}`}${sizeLabel(d)}`;
}

export function windowLabel(w: WindowTarget): string {
  const place = w.monitor === null ? "" : ` on ${w.monitor}`;
  const title = w.title === "" ? "" : ` · ${w.title}`;
  return `${w.appId}${title} (${w.width}×${w.height}${place})${
    w.focused ? " · focused" : ""
  }`;
}

/** Select entries for the scan page, in list order. */
export function toOptions(targets: ScanTargets): ScanTargetOptions {
  return {
    displays: targets.displays.map((d) => ({
      value: displayToken(d.name),
      label: displayLabel(d),
    })),
    windows: targets.windows.map((w) => ({
      value: windowToken(w.id),
      label: windowLabel(w),
    })),
    notes: targets.notes,
  };
}

/** A "display:DP-2" / "window:12" token back to a request; null when unknown. */
export function parseToken(token: string): CaptureRequest | null {
  const value = (token ?? "").trim();
  if (value.startsWith("display:")) {
    const name = value.slice("display:".length);
    return DISPLAY_NAME.test(name) ? { kind: "display", name } : null;
  }
  if (value.startsWith("window:")) {
    const id = value.slice("window:".length);
    return WINDOW_ID.test(id) ? { kind: "window", id } : null;
  }
  return null;
}

/**
 * Turn a page choice into runner arguments. The form carries tokens
 * (`display:DP-2`, `window:7`); an empty choice captures every output (the
 * runner's own default). A chosen window wins over a chosen display, because a
 * window is the narrower request; a stale window, a stale display, or a token
 * this host does not know is refused instead of silently capturing something
 * else.
 */
export function resolveCapture(
  targets: ScanTargets,
  display: string,
  window: string,
): { ok: true; capture: ResolvedCapture } | { ok: false; error: string } {
  const displayChoice = (display ?? "").trim();
  const windowChoice = (window ?? "").trim();

  if (windowChoice !== "") {
    const request = parseToken(windowChoice);
    if (request === null || request.kind !== "window") {
      return { ok: false, error: `Unknown window "${windowChoice}".` };
    }
    const found = targets.windows.find((w) => w.id === request.id) ?? null;
    if (found === null) {
      return {
        ok: false,
        error:
          "That window is not open any more — refresh the window list and choose again.",
      };
    }
    return {
      ok: true,
      capture: {
        args: [
          "--region",
          regionOf(found.x, found.y, found.width, found.height),
        ],
        label: windowLabel(found),
      },
    };
  }

  if (displayChoice !== "") {
    const request = parseToken(displayChoice);
    if (request === null || request.kind !== "display") {
      return { ok: false, error: `Unknown display "${displayChoice}".` };
    }
    if (
      targets.displays.length > 0 &&
      !targets.displays.some((d) => d.name === request.name)
    ) {
      return {
        ok: false,
        error:
          "That display is not connected any more — refresh the display list and choose again.",
      };
    }
    return {
      ok: true,
      capture: {
        args: ["--output", request.name],
        label: request.name,
      },
    };
  }

  return {
    ok: true,
    capture: { args: [], label: "every output (automatic)" },
  };
}
