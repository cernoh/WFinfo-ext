import { assertEquals, assertStringIncludes, assertTrue } from "./testutil.ts";
import {
  type CommandOutput,
  type CommandRunner,
  discoverTargets,
  parseMangoWindows,
  parseRandrDisplays,
  parseRandrTextDisplays,
  parseToken,
  parseToplevelNames,
  regionOf,
  resolveCapture,
  type ScanTargets,
  toOptions,
} from "./targets.ts";

/** A stand-in host: file name + first argument → canned output. */
function fakeRunner(
  responses: Record<string, CommandOutput>,
): { runner: CommandRunner; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runner: {
      run(file, args) {
        const key = `${file} ${args.join(" ")}`.trim();
        calls.push(key);
        return Promise.resolve(
          responses[key] ?? { code: null, stdout: "" },
        );
      },
    },
  };
}

Deno.test("wlr-randr JSON becomes displays with size and layout position", () => {
  const displays = parseRandrDisplays([
    {
      name: "DP-2",
      model: "HUAWEI AD80HW",
      enabled: true,
      position: { x: 1920, y: 0 },
      scale: 1,
      modes: [
        { width: 1280, height: 720, current: false },
        { width: 1920, height: 1080, current: true },
      ],
    },
    {
      name: "HDMI-A-1",
      enabled: false,
      position: { x: 0, y: 0 },
      modes: [{ width: 1920, height: 1080, current: true }],
    },
  ]);

  assertEquals(displays.length, 1, "a disabled output is not capturable");
  assertEquals(displays[0], {
    name: "DP-2",
    model: "HUAWEI AD80HW",
    width: 1920,
    height: 1080,
    x: 1920,
    y: 0,
  });
});

Deno.test("wlr-randr JSON without a current mode keeps the name", () => {
  const displays = parseRandrDisplays([{ name: "DP-1", enabled: true }]);

  assertEquals(displays, [{
    name: "DP-1",
    model: null,
    width: null,
    height: null,
    x: null,
    y: null,
  }]);
});

Deno.test("plain wlr-randr text yields enabled output names", () => {
  const text = [
    'DP-2 "Huawei Technologies Co., Inc. HUAWEI AD80HW (DP-2)"',
    "  Make: Huawei Technologies Co., Inc.",
    "  Enabled: yes",
    'HDMI-A-1 "Unknown (HDMI-A-1)"',
    "  Enabled: no",
    'DP-1 "AOC 24G2W1G3- (DP-1)"',
    "  Enabled: yes",
  ].join("\n");

  assertEquals(parseRandrTextDisplays(text).map((d) => d.name), [
    "DP-2",
    "DP-1",
  ]);
});

Deno.test("mango client list becomes windows with a capture rectangle", () => {
  const windows = parseMangoWindows({
    clients: [
      {
        id: 4,
        appid: "com.mitchellh.ghostty",
        title: "NIXPC: dendritic",
        monitor: "DP-1",
        x: 10,
        y: 44,
        width: 1900,
        height: 1026,
        is_focused: true,
        is_visible: true,
      },
      {
        id: 7,
        appid: "steam_app_230410",
        title: "Warframe",
        monitor: "DP-2",
        x: 1920,
        y: 0,
        width: 1920,
        height: 1080,
        is_focused: false,
        is_visible: true,
      },
      {
        id: 9,
        appid: "hidden",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        is_visible: false,
      },
      { id: 11, appid: "minimized", x: 0, y: 0, width: 0, height: 0 },
    ],
  });

  assertEquals(windows.map((w) => w.id), ["4", "7"], "visible clients only");
  assertEquals(windows[1], {
    id: "7",
    appId: "steam_app_230410",
    title: "Warframe",
    monitor: "DP-2",
    x: 1920,
    y: 0,
    width: 1920,
    height: 1080,
    focused: false,
  });
  assertTrue(windows[0].focused, "the focused window sorts first");
});

Deno.test("wlrctl toplevel names are readable but carry no geometry", () => {
  assertEquals(
    parseToplevelNames(
      "com.mitchellh.ghostty: NIXPC: dendritic\nsteam_app_230410: Warframe\n",
    ),
    ["com.mitchellh.ghostty — NIXPC: dendritic", "steam_app_230410 — Warframe"],
  );
});

Deno.test("discovery reads displays and windows from this host", async () => {
  const { runner, calls } = fakeRunner({
    "wlr-randr --json": {
      code: 0,
      stdout: JSON.stringify([{
        name: "DP-1",
        enabled: true,
        position: { x: 0, y: 0 },
        modes: [{ width: 1920, height: 1080, current: true }],
      }]),
    },
    "mmsg get all-clients": {
      code: 0,
      stdout: JSON.stringify({
        clients: [{
          id: 4,
          appid: "steam_app_230410",
          title: "Warframe",
          monitor: "DP-1",
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          is_focused: true,
        }],
      }),
    },
  });

  const targets = await discoverTargets(runner);

  assertEquals(targets.displays.map((d) => d.name), ["DP-1"]);
  assertEquals(targets.windows.map((w) => w.id), ["4"]);
  assertEquals(targets.notes, []);
  assertEquals(calls, ["wlr-randr --json", "mmsg get all-clients"]);
});

Deno.test("discovery without compositor tools reports what is missing", async () => {
  const { runner } = fakeRunner({});

  const targets = await discoverTargets(runner);

  assertEquals(targets.displays, []);
  assertEquals(targets.windows, []);
  assertEquals(targets.notes.length, 2);
  assertStringIncludes(targets.notes[0], "wlr-randr is not on PATH");
  assertStringIncludes(targets.notes[1], "mmsg");
});

Deno.test("discovery names windows it cannot place when only wlrctl answers", async () => {
  const { runner } = fakeRunner({
    "wlrctl toplevel list": {
      code: 0,
      stdout: "steam_app_230410: Warframe\n",
    },
  });

  const targets = await discoverTargets(runner);

  assertEquals(targets.windows, []);
  assertStringIncludes(targets.notes.join(" "), "steam_app_230410 — Warframe");
});

const host: ScanTargets = {
  displays: [{
    name: "DP-2",
    model: "HUAWEI AD80HW",
    width: 1920,
    height: 1080,
    x: 1920,
    y: 0,
  }],
  windows: [{
    id: "7",
    appId: "steam_app_230410",
    title: "Warframe",
    monitor: "DP-2",
    x: 1930,
    y: 44,
    width: 1900,
    height: 1026,
    focused: true,
  }],
  notes: [],
};

Deno.test("a chosen window becomes the grim region of its frame", () => {
  const resolution = resolveCapture(host, "", "window:7");

  assertTrue(resolution.ok);
  if (!resolution.ok) return;
  assertEquals(resolution.capture.args, ["--region", "1930,44 1900x1026"]);
  assertStringIncludes(resolution.capture.label, "steam_app_230410");
  assertStringIncludes(resolution.capture.label, "Warframe");
});

Deno.test("a window wins over the display it sits on", () => {
  const resolution = resolveCapture(host, "display:DP-2", "window:7");

  assertTrue(resolution.ok);
  if (!resolution.ok) return;
  assertEquals(resolution.capture.args[0], "--region");
});

Deno.test("a chosen display becomes the grim output", () => {
  const resolution = resolveCapture(host, "display:DP-2", "");

  assertTrue(resolution.ok);
  if (!resolution.ok) return;
  assertEquals(resolution.capture, {
    args: ["--output", "DP-2"],
    label: "DP-2",
  });
});

Deno.test("no choice leaves the runner its own every-output default", () => {
  const resolution = resolveCapture(host, "", "");

  assertTrue(resolution.ok);
  if (!resolution.ok) return;
  assertEquals(resolution.capture.args, []);
});

Deno.test("a stale window or display is refused, never substituted", () => {
  const gone = resolveCapture(host, "", "window:42");
  assertTrue(!gone.ok);
  if (gone.ok) return;
  assertStringIncludes(gone.error, "not open any more");

  const unplugged = resolveCapture(host, "display:HDMI-A-1", "");
  assertTrue(!unplugged.ok);
  if (unplugged.ok) return;
  assertStringIncludes(unplugged.error, "not connected any more");

  const nonsense = resolveCapture(host, "", "window:7; rm -rf /");
  assertTrue(!nonsense.ok, "a token that is not a token is refused");

  const wrongKind = resolveCapture(host, "", "display:DP-2");
  assertTrue(!wrongKind.ok, "a display token in the window field is refused");
});

Deno.test("tokens round-trip and reject anything else", () => {
  assertEquals(parseToken("display:DP-2"), { kind: "display", name: "DP-2" });
  assertEquals(parseToken("window:7"), { kind: "window", id: "7" });
  assertEquals(parseToken("window:$(whoami)"), null);
  assertEquals(parseToken(""), null);

  const options = toOptions(host);
  assertEquals(options.displays[0].value, "display:DP-2");
  assertStringIncludes(options.displays[0].label, "1920×1080");
  assertEquals(options.windows[0].value, "window:7");
  assertEquals(regionOf(1930, 44, 1900, 1026), "1930,44 1900x1026");
});
