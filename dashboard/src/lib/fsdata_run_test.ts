import { assertEquals } from "./testutil.ts";
import { parseSuiteResult } from "./fsdata.ts";

const pascal = {
  TestSuiteName: "map",
  StartTime: "2026-09-07T21:11:30.6666933Z",
  EndTime: "2026-09-07T21:11:30.7044431Z",
  TestResults: [
    {
      TestCaseName: "test1",
      Success: false,
      AccuracyScore: 0.0,
      ActualParts: [],
      MissingParts: ["Volt Prime Blueprint"],
      ExtraParts: [],
      ErrorMessage: "PNG not found: /x/test1.png",
      ProcessingTimeMs: 1,
    },
    {
      TestCaseName: "test2",
      Success: true,
      AccuracyScore: 100.0,
      ActualParts: ["Volt Prime Chassis"],
      MissingParts: [],
      ExtraParts: [],
      ErrorMessage: null,
      ProcessingTimeMs: 42,
    },
  ],
  TotalTests: 2,
  PassedTests: 1,
  FailedTests: 0,
  ErrorTests: 1,
  OverallAccuracy: 50.0,
  PassRate: 50.0,
};

Deno.test("parseSuiteResult reads PascalCase suite output", () => {
  const r = parseSuiteResult(pascal, "latest.json");
  assertEquals(r !== null, true);
  const rec = r!;
  assertEquals(rec.suite, "map");
  assertEquals(rec.total, 2);
  assertEquals(rec.passed, 1);
  assertEquals(rec.errors, 1);
  assertEquals(rec.scenarios.length, 2);
  assertEquals(rec.scenarios[0].name, "test1");
  assertEquals(rec.scenarios[0].success, false);
  assertEquals(rec.scenarios[0].missingParts, ["Volt Prime Blueprint"]);
  assertEquals(rec.scenarios[0].errorMessage, "PNG not found: /x/test1.png");
  assertEquals(rec.scenarios[1].actualParts, ["Volt Prime Chassis"]);
  assertEquals(rec.startedMs, Date.parse("2026-09-07T21:11:30.6666933Z"));
});

Deno.test("parseSuiteResult tolerates camelCase", () => {
  const camel = JSON.parse(
    JSON.stringify(pascal).replaceAll("TestSuiteName", "testSuiteName")
      .replaceAll(
        "TestResults",
        "testResults",
      ),
  );
  const rec = parseSuiteResult(camel, "x.json");
  assertEquals(rec?.suite, "map");
  assertEquals(rec?.scenarios.length, 2);
});

Deno.test("parseSuiteResult rejects non-suite objects", () => {
  assertEquals(parseSuiteResult({ hello: "world" }, "x.json"), null);
  assertEquals(parseSuiteResult(null, "x.json"), null);
  assertEquals(parseSuiteResult([1, 2], "x.json"), null);
});
