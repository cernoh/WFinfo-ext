import { assertEquals, assertTrue } from "./testutil.ts";
import {
  parseLogLines,
  parseLogTimestamp,
  resolveAppDir,
  tailLines,
} from "./fsdata.ts";

Deno.test("resolveAppDir prefers APPDATA on Windows-style env", () => {
  assertEquals(
    resolveAppDir({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }),
    "C:\\Users\\x\\AppData\\Roaming/WFInfo",
  );
});

Deno.test("resolveAppDir honors WFINFO_DATA_DIR like the headless runner", () => {
  assertEquals(
    resolveAppDir({ WFINFO_DATA_DIR: "/tmp/wf-root" }),
    "/tmp/wf-root/WFInfo",
  );
});

Deno.test("resolveAppDir uses XDG_CONFIG_HOME when present", () => {
  assertEquals(
    resolveAppDir({ XDG_CONFIG_HOME: "/home/u/.config" }),
    "/home/u/.config/WFInfo",
  );
});

Deno.test("resolveAppDir falls back to HOME/.config", () => {
  assertEquals(
    resolveAppDir({ HOME: "/home/u" }),
    "/home/u/.config/WFInfo",
  );
});

Deno.test("WFINFO_DATA_DIR wins over XDG_CONFIG_HOME", () => {
  assertEquals(
    resolveAppDir({ WFINFO_DATA_DIR: "/a", XDG_CONFIG_HOME: "/b" }),
    "/a/WFInfo",
  );
});

const anchor = Date.UTC(2026, 8, 7, 21, 9, 0); // 2026-09-07 21:09 UTC

Deno.test("parseLogTimestamp parses en-GB dd/MM/yyyy 24h", () => {
  const { ts, rest } = parseLogTimestamp(
    "[07/09/2026 21:09:12]   Initializing Databases",
    anchor,
  );
  assertEquals(ts, Date.UTC(2026, 8, 7, 21, 9, 12));
  assertEquals(rest, "Initializing Databases");
});

Deno.test("parseLogTimestamp resolves ambiguity toward the file anchor", () => {
  // 07/09 near a September anchor should read as 7 Sep, not 9 July.
  const { ts } = parseLogTimestamp("[07/09/2026 21:09:12]", anchor);
  assertEquals(ts, Date.UTC(2026, 8, 7, 21, 9, 12));
  // Near a July anchor the same text reads as 9 July.
  const julyAnchor = Date.UTC(2026, 6, 10);
  const { ts: ts2 } = parseLogTimestamp("[07/09/2026 21:09:12]", julyAnchor);
  assertEquals(ts2, Date.UTC(2026, 6, 9, 21, 9, 12));
});

Deno.test("parseLogTimestamp handles 12-hour en-US lines", () => {
  const { ts } = parseLogTimestamp(
    "[9/7/2026 9:09:12 PM]   message",
    Date.UTC(2026, 8, 7),
  );
  assertEquals(ts, Date.UTC(2026, 8, 7, 21, 9, 12));
});

Deno.test("parseLogTimestamp rejects impossible dates", () => {
  const { ts } = parseLogTimestamp("[31/02/2026 10:00:00]", anchor);
  assertEquals(ts, null);
});

Deno.test("parseLogLines skips blank lines and keeps messages", () => {
  const text =
    "[07/09/2026 21:09:12]   first\n\n[07/09/2026 21:09:13]   second";
  const entries = parseLogLines(text, anchor);
  assertEquals(entries.length, 2);
  assertEquals(entries[0].message, "first");
  assertEquals(entries[1].message, "second");
});

Deno.test("tailLines returns newest first and drops trailing partial line", () => {
  const text = "a\nb\nc\npartial";
  const lines = tailLines(text, 10);
  assertEquals(lines, ["c", "b", "a"]);
});

Deno.test("tailLines caps at maxLines", () => {
  const text = "1\n2\n3\n4\n5\n";
  const lines = tailLines(text, 2);
  assertEquals(lines, ["5", "4"]);
  assertTrue(lines.length === 2);
});
