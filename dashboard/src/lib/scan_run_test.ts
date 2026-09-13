import { assertEquals, assertStringIncludes } from "./testutil.ts";

/**
 * Route proof for POST /scan/run — the "Scan now" button. src/main.ts builds
 * its scanner from the environment at import time, so WFINFO_SCAN_CMD is set
 * BEFORE the module is imported. The command is a stand-in for the flake's
 * scan app: it copies a prepared scan record into the app data dir, exactly
 * like the real runner writes one.
 *
 * This test lives in its own file because Deno gives each test file its own
 * worker: an already-imported main.ts cannot pick up a different command.
 */
Deno.test("POST /scan/run runs the scan command and reports the outcome", async () => {
  const root = await Deno.makeTempDir({ prefix: "wfinfo_scan_run_" });
  try {
    const appDir = `${root}/WFInfo`;
    await Deno.mkdir(`${appDir}/scans`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/record.json`,
      JSON.stringify({
        Version: 1,
        StartedAt: "2026-09-10T14:31:02.123Z",
        DurationMs: 1357,
        CaptureSource: "grim",
        CaptureTarget: "DP-2",
        Choices: [{
          Index: 1,
          Part: "Mirage Prime Systems",
          Slug: "mirage_prime_systems",
          Plat: 62,
          PlatSource: "wfm",
          Volume: 17,
          Ducats: 45,
          Best: true,
        }],
        Best: { Index: 1, Part: "Mirage Prime Systems", Plat: 62 },
        PriceCache: { Hits: 0, Fetched: 1, Failed: 0, Entries: 137 },
        Error: null,
      }),
    );

    // The marker files steer the stand-in command, so one worker can exercise
    // success, failure and a run that is still in flight.
    const command = [
      `if [ -f '${root}/slow' ]; then sleep 0.6; fi`,
      `if [ -f '${root}/fail' ]; then echo 'boom: no display' >&2; exit 4; fi`,
      `cp '${root}/record.json' '${appDir}/scans/latest.json'`,
      `echo 'captured DP-2'`,
    ].join("; ");
    Deno.env.set("WFINFO_DATA_DIR", root);
    Deno.env.set("WFINFO_SCAN_CMD", command);
    const { handler } = await import("../main.ts");

    // The /scan page carries the button, wired to the route.
    const page = await handler(new Request("http://localhost/scan"));
    const pageText = await page.text();
    assertStringIncludes(pageText, 'action="/scan/run"');
    assertStringIncludes(pageText, "Scan now");

    // A click: same-origin POST from the loopback host.
    const click = () =>
      handler(
        new Request("http://localhost/scan/run", {
          method: "POST",
          headers: {
            origin: "http://localhost",
            host: "localhost",
            accept: "application/json",
          },
        }),
        loopback,
      );

    const resp = await click();
    assertEquals(resp.status, 200);
    const data = await resp.json();
    assertEquals(data.ok, true);
    assertEquals(data.exitCode, 0);
    assertStringIncludes(data.output, "captured DP-2");
    assertStringIncludes(data.message, "Scan complete");

    // The scan the button started is what the page now shows.
    const refreshed = await handler(new Request("http://localhost/api/scan"));
    assertStringIncludes(
      (await refreshed.json()).body as string,
      "Take: Mirage Prime Systems",
    );

    // A second click while a scan is in flight is refused, never queued: two
    // runs would capture the screen twice and race on the scan record.
    await Deno.writeTextFile(`${root}/slow`, "");
    const inFlight = click();
    const second = await click();
    assertEquals(second.status, 409);
    assertStringIncludes((await second.json()).error, "already running");
    assertEquals((await inFlight).status, 200);
    await Deno.remove(`${root}/slow`);

    // A failing scan answers 502 with the command's own output.
    await Deno.writeTextFile(`${root}/fail`, "");
    const failed = await click();
    assertEquals(failed.status, 502);
    const failedJson = await failed.json();
    assertEquals(failedJson.ok, false);
    assertEquals(failedJson.exitCode, 4);
    assertStringIncludes(failedJson.message, "exit code 4");
    assertStringIncludes(failedJson.output, "boom: no display");

    // The same failure without the script (a plain form post) gets a page.
    const postPlain = () =>
      handler(
        new Request("http://localhost/scan/run", {
          method: "POST",
          headers: { origin: "http://localhost", host: "localhost" },
        }),
        loopback,
      );
    const failedPage = await postPlain();
    assertEquals(failedPage.status, 200);
    const failedPageText = await failedPage.text();
    assertStringIncludes(failedPageText, "Something went wrong");
    assertStringIncludes(failedPageText, "boom: no display");
    await Deno.remove(`${root}/fail`);

    // Without the script a successful form post redirects back to the page.
    const plain = await postPlain();
    assertEquals(plain.status, 302);
    assertEquals(plain.headers.get("location"), "/scan");

    // A scan runs on this machine's screen: another host is refused unless the
    // operator opts in, and a cross-site post is refused outright.
    const remote = await handler(
      new Request("http://localhost/scan/run", {
        method: "POST",
        headers: { accept: "application/json" },
      }),
      otherHost,
    );
    assertEquals(remote.status, 403);
    assertStringIncludes((await remote.json()).error, "WFINFO_SCAN_REMOTE");

    const crossSite = await handler(
      new Request("http://localhost/scan/run", {
        method: "POST",
        headers: {
          accept: "application/json",
          origin: "http://evil.example",
          host: "localhost",
        },
      }),
      loopback,
    );
    assertEquals(crossSite.status, 403);
    assertStringIncludes(
      (await crossSite.json()).error,
      "did not come from the dashboard page",
    );

    // The route is a POST; a GET only ever reads.
    const get = await handler(new Request("http://localhost/scan/run"));
    assertEquals(get.status, 405);
  } finally {
    Deno.env.delete("WFINFO_SCAN_CMD");
    await Deno.remove(root, { recursive: true });
  }
});

const loopback: Deno.ServeHandlerInfo = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 51320 },
  completed: Promise.resolve(),
};

const otherHost: Deno.ServeHandlerInfo = {
  remoteAddr: { transport: "tcp", hostname: "192.168.1.50", port: 42210 },
  completed: Promise.resolve(),
};
