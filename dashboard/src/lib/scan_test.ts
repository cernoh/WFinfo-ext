import { assertEquals } from "./testutil.ts";
import {
  parseScanResult,
  resolveBest,
  resolveBestChoice,
  type ScanResult,
} from "./scan.ts";

/* A complete record exactly as the contract describes it. */
const complete = {
  Version: 1,
  StartedAt: "2026-09-10T14:31:02.123Z",
  FinishedAt: "2026-09-10T14:31:03.480Z",
  DurationMs: 1357,
  CaptureSource: "grim",
  CaptureTarget: "DP-2",
  ScreenshotPath: "/home/davr/.config/WFInfo/scans/last.png",
  ScreenshotWidth: 1920,
  ScreenshotHeight: 1080,
  UiScaling: 1.0,
  Choices: [
    {
      Index: 1,
      Part: "Volt Prime Blueprint",
      Slug: "volt_prime_blueprint",
      Plat: 12.5,
      PlatSource: "cache",
      PlatFetchedAt: "2026-09-10T10:05:00.000Z",
      Volume: 41,
      Ducats: 25,
      Best: false,
    },
    {
      Index: 2,
      Part: "Mirage Prime Systems",
      Slug: "mirage_prime_systems",
      Plat: 62,
      PlatSource: "wfm",
      PlatFetchedAt: "2026-09-10T14:31:03.201Z",
      Volume: 17,
      Ducats: 45,
      Best: true,
    },
  ],
  Best: { Index: 2, Part: "Mirage Prime Systems", Plat: 62.0 },
  BestDucats: { Index: 2, Part: "Mirage Prime Systems", Ducats: 45 },
  PriceCache: { Hits: 1, Fetched: 1, Failed: 0, Entries: 137 },
  Error: null,
};

Deno.test("parseScanResult reads a complete record", () => {
  const scan = parseScanResult(complete);
  assertEquals(scan === null, false);
  const s = scan!;
  assertEquals(s.version, 1);
  assertEquals(s.startedMs, Date.parse("2026-09-10T14:31:02.123Z"));
  assertEquals(s.finishedMs, Date.parse("2026-09-10T14:31:03.480Z"));
  assertEquals(s.durationMs, 1357);
  assertEquals(s.captureSource, "grim");
  assertEquals(s.captureTarget, "DP-2");
  assertEquals(s.uiScaling, 1.0);
  assertEquals(s.error, null);
  assertEquals(s.priceCache, { hits: 1, fetched: 1, failed: 0, entries: 137 });
  assertEquals(s.choices.length, 2);
  assertEquals(s.choices[1], {
    index: 2,
    part: "Mirage Prime Systems",
    slug: "mirage_prime_systems",
    plat: 62,
    platSource: "wfm",
    platFetchedAt: "2026-09-10T14:31:03.201Z",
    volume: 17,
    ducats: 45,
    best: true,
  });
  assertEquals(s.best, { index: 2, part: "Mirage Prime Systems", plat: 62 });
});

Deno.test("parseScanResult accepts a record with no choices", () => {
  // A scan that finds no reward screen still writes a record (contract).
  const scan = parseScanResult({
    Version: 1,
    StartedAt: "2026-09-10T14:31:02.123Z",
    Choices: [],
    PriceCache: { Hits: 0, Fetched: 0, Failed: 0, Entries: 0 },
    Error: null,
  });
  assertEquals(scan === null, false);
  assertEquals(scan!.choices, []);
  assertEquals(scan!.best, null);
  assertEquals(scan!.bestDucats, null);
  assertEquals(scan!.error, null);
});

Deno.test("parseScanResult tolerates null prices and string numbers", () => {
  const scan = parseScanResult({
    Version: 1,
    StartedAt: "2026-09-10T14:31:02.123Z",
    Choices: [
      {
        Index: 1,
        Part: "Ash Prime Chassis",
        Slug: "ash_prime_chassis",
        Plat: null,
        PlatSource: "none",
        PlatFetchedAt: null,
        Volume: null,
        Ducats: null,
        Best: false,
      },
      {
        Index: 2,
        Part: "Ash Prime Blueprint",
        Slug: null,
        // Prices may arrive as JSON strings; keep the numeric value.
        Plat: "15.5",
        Volume: "8",
        Ducats: "45",
        PlatSource: "sheet",
      },
    ],
    Error: null,
  });
  assertEquals(scan === null, false);
  const s = scan!;
  assertEquals(s.choices[0].plat, null);
  assertEquals(s.choices[0].volume, null);
  assertEquals(s.choices[0].ducats, null);
  assertEquals(s.choices[1].plat, 15.5);
  assertEquals(s.choices[1].volume, 8);
  assertEquals(s.choices[1].ducats, 45);
  assertEquals(s.choices[1].slug, null);
});

Deno.test("parseScanResult keeps a set error message", () => {
  const scan = parseScanResult({
    StartedAt: "2026-09-10T14:31:02.123Z",
    Choices: [],
    Error: "capture failed: grim returned no output",
  });
  assertEquals(scan!.error, "capture failed: grim returned no output");
});

Deno.test("parseScanResult rejects non-object records", () => {
  assertEquals(parseScanResult(null), null);
  assertEquals(parseScanResult("[1,2]"), null);
  assertEquals(parseScanResult(42), null);
});

Deno.test("resolveBestChoice picks the highest platinum choice", () => {
  const scan = parseScanResult(complete)!;
  assertEquals(resolveBestChoice(scan.choices), scan.choices[1]);
});

Deno.test("resolveBestChoice breaks plat ties by higher ducats", () => {
  const mk = (index: number, plat: number | null, ducats: number | null) => ({
    index,
    part: `Part ${index}`,
    slug: null,
    plat,
    platSource: null,
    platFetchedAt: null,
    volume: null,
    ducats,
    best: false,
  });
  const choices = [mk(1, 30, 15), mk(2, 30, 45), mk(3, 30, 20)];
  assertEquals(resolveBestChoice(choices), choices[1]);
});

Deno.test("resolveBestChoice breaks plat+ducat ties by the later index", () => {
  const mk = (index: number, plat: number | null, ducats: number | null) => ({
    index,
    part: `Part ${index}`,
    slug: null,
    plat,
    platSource: null,
    platFetchedAt: null,
    volume: null,
    ducats,
    best: false,
  });
  const choices = [mk(1, 30, 15), mk(2, 30, 15), mk(3, 12, 99)];
  assertEquals(resolveBestChoice(choices), choices[1]);
});

Deno.test("resolveBestChoice returns null when no choice has a price", () => {
  const scan = parseScanResult({
    Version: 1,
    Choices: [
      {
        Index: 1,
        Part: "Ash Prime Chassis",
        Plat: null,
        PlatSource: "none",
      },
    ],
  })!;
  assertEquals(resolveBestChoice(scan.choices), null);
});

Deno.test("resolveBest trusts the Best flag then Best.Index", () => {
  const scan = parseScanResult(complete)!;
  // Best.Best is true on choice 2 and Best.Index says 2: both agree.
  assertEquals(resolveBest(scan), scan.choices[1]);
  const flaggedOnly: ScanResult = { ...scan, best: null };
  assertEquals(resolveBest(flaggedOnly), scan.choices[1]);
  // No Best flag at all: recompute from Choices with the tie rules.
  const unflagged: ScanResult = {
    ...scan,
    best: null,
    choices: scan.choices.map((c) => ({ ...c, best: false })),
  };
  assertEquals(resolveBest(unflagged), unflagged.choices[1]);
});

Deno.test("resolveBest falls back to recomputation from Choices", () => {
  const scan = parseScanResult({
    Version: 1,
    StartedAt: "2026-09-10T14:31:02.123Z",
    Choices: [
      { Index: 1, Part: "A", Plat: 10, Ducats: 15, Best: false },
      { Index: 2, Part: "B", Plat: 10, Ducats: 15, Best: false },
    ],
    Best: null,
  })!;
  // Equal plat and ducats: the later index wins.
  assertEquals(resolveBest(scan)?.part, "B");
});
