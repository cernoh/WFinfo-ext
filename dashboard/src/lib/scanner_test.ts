import { assertEquals, assertStringIncludes, assertTrue } from "./testutil.ts";
import { Scanner } from "./scanner.ts";

/* The scanner shells out to `sh`, so the commands below are portable and
   deterministic: no network, no files written outside nothing at all. */

Deno.test("scanner runs a command and reports success", async () => {
  const scanner = new Scanner({ command: "echo scanned" });
  assertTrue(!scanner.busy, "a fresh scanner is free");

  const outcome = await scanner.run();

  assertEquals(outcome.status, "ok");
  assertEquals(outcome.exitCode, 0);
  assertStringIncludes(outcome.output, "scanned");
  assertTrue(!scanner.busy, "the scanner is free again after the run");
});

Deno.test("scanner reports a failing command with its output", async () => {
  const scanner = new Scanner({ command: "echo boom >&2; exit 3" });

  const outcome = await scanner.run();

  assertEquals(outcome.status, "failed");
  assertEquals(outcome.exitCode, 3);
  assertStringIncludes(outcome.output, "boom");
});

Deno.test("scanner refuses a second run while one is in flight", async () => {
  const scanner = new Scanner({ command: "sleep 0.4" });
  const first = scanner.run();
  assertTrue(scanner.busy, "the first run holds the scanner");

  let refused = false;
  try {
    scanner.run();
  } catch {
    refused = true;
  }
  assertTrue(refused, "the second run is refused, never queued");

  assertEquals((await first).status, "ok");
  assertTrue(!scanner.busy, "the scanner frees up when the run ends");
});

Deno.test("scanner kills a command that passes the deadline", async () => {
  // `sleep 5` would outlive the test; the deadline must end the run instead.
  const scanner = new Scanner({ command: "sleep 5", timeoutMs: 150 });
  const startedMs = Date.now();

  const outcome = await scanner.run();

  assertEquals(outcome.status, "timeout");
  assertTrue(
    Date.now() - startedMs < 3000,
    "the run ended at the deadline, not at the command's own exit",
  );
  assertTrue(!scanner.busy, "a stopped run frees the scanner");
});
