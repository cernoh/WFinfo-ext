import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertTrue,
} from "./testutil.ts";

/**
 * Route proof for the scan endpoints. src/main.ts resolves its app-data dir
 * from the environment at import time, so the fixture directory is created
 * and WFINFO_DATA_DIR is set BEFORE the module is imported, and removed in
 * the test's cleanup.
 */
Deno.test("scan routes: page, API and screenshot against a fixture app dir", async () => {
  const root = await Deno.makeTempDir({ prefix: "wfinfo_scan_route_" });
  try {
    const appDir = `${root}/WFInfo`;
    await Deno.mkdir(`${appDir}/scans`, { recursive: true });
    const record = {
      Version: 1,
      StartedAt: "2026-09-10T14:31:02.123Z",
      FinishedAt: "2026-09-10T14:31:03.480Z",
      DurationMs: 1357,
      CaptureSource: "grim",
      CaptureTarget: "DP-2",
      ScreenshotPath: `${appDir}/scans/last.png`,
      ScreenshotWidth: 1920,
      ScreenshotHeight: 1080,
      UiScaling: 1.0,
      Choices: [
        {
          Index: 1,
          Part: "Volt & Prime <Blueprint>",
          Slug: "volt_prime_blueprint",
          Plat: "12.5",
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
      PriceCache: { Hits: 1, Fetched: 1, Failed: 0, Entries: 137 },
      Error: null,
    };
    await Deno.writeTextFile(
      `${appDir}/scans/latest.json`,
      JSON.stringify(record),
    );
    const shot = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    Deno.writeFileSync(`${appDir}/scans/last.png`, shot);

    // Dynamic import on purpose: the module under test resolves its app dir
    // from the environment at import time, so a static import would capture
    // the real user directory before the fixture can be configured.
    Deno.env.set("WFINFO_DATA_DIR", root);
    const { handler } = await import("../main.ts");

    // /scan — the page renders the verdict, the choice table and metadata.
    const page = await handler(new Request("http://localhost/scan"));
    assertEquals(page.status, 200);
    const pageText = await page.text();
    assertMatch(pageText, /<title>Scan — Warframe Info<\/title>/);
    assertStringIncludes(pageText, "Take: Mirage Prime Systems");
    assertStringIncludes(pageText, "Best platinum return: 62 plat");
    // File-derived text is HTML-escaped, including part names.
    assertStringIncludes(pageText, "Volt &amp; Prime &lt;Blueprint&gt;");
    assertStringIncludes(pageText, "govuk-table");
    assertStringIncludes(pageText, "mirage_prime_systems");
    assertStringIncludes(pageText, "grim · DP-2");
    assertStringIncludes(pageText, "/scan/screenshot");

    // /api/scan — the JSON body carries the same rendered markup for polling.
    const api = await handler(new Request("http://localhost/api/scan"));
    assertEquals(api.status, 200);
    assertMatch(
      api.headers.get("content-type") ?? "",
      /^application\/json/,
    );
    const apiJson = await api.json();
    assertEquals(typeof apiJson.updatedAt, "number");
    assertStringIncludes(apiJson.body as string, "Take: Mirage Prime Systems");
    assertStringIncludes(
      apiJson.body as string,
      "Best platinum return: 62 plat",
    );
    assertStringIncludes(
      apiJson.body as string,
      "Volt &amp; Prime &lt;Blueprint&gt;",
    );

    // /scan/screenshot — the newest capture, always exactly that file.
    const shotResp = await handler(
      new Request("http://localhost/scan/screenshot"),
    );
    assertEquals(shotResp.status, 200);
    assertEquals(shotResp.headers.get("content-type"), "image/png");
    assertEquals(new Uint8Array(await shotResp.arrayBuffer()), shot);

    // Missing screenshot: 404, never an arbitrary-path or page fallback.
    await Deno.remove(`${appDir}/scans/last.png`);
    const missing = await handler(
      new Request("http://localhost/scan/screenshot"),
    );
    assertEquals(missing.status, 404);

    // No scan record at all: the empty-state page and an empty API body.
    await Deno.remove(`${appDir}/scans/latest.json`);
    const empty = await handler(new Request("http://localhost/scan"));
    assertEquals(empty.status, 200);
    const emptyText = await empty.text();
    assertStringIncludes(emptyText, "No scan recorded yet");
    assertStringIncludes(emptyText, "nix run .#scan");
    const emptyApi = await handler(new Request("http://localhost/api/scan"));
    const emptyApiJson = await emptyApi.json();
    assertStringIncludes(emptyApiJson.body as string, "No scan recorded yet");
  } finally {
    await Deno.remove(root, { recursive: true });
    assertTrue(!(await exists(root)), "fixture removed");
  }
});

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}
