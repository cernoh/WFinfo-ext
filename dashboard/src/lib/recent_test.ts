import { assertEquals } from "./testutil.ts";
import { extractRewardEvents } from "./recent.ts";
import { parseLogLines } from "./fsdata.ts";

const anchor = Date.UTC(2026, 8, 7, 21, 9, 0);

Deno.test("extractRewardEvents parses multi-token reward lines", () => {
  const text =
    `[07/09/2026 21:09:12]   Loki Prime Systems Blueprint || Forma, detected choice: 0
[07/09/2026 21:09:13]   Other status line
[07/09/2026 21:10:01]   Volt Prime Chassis || Volt Prime Neuroptics, detected choice: 1`;
  const events = extractRewardEvents(parseLogLines(text, anchor));
  assertEquals(events.length, 2);
  assertEquals(events[0].rewards, ["Loki Prime Systems Blueprint", "Forma"]);
  assertEquals(events[0].chosen, 0);
  assertEquals(events[1].rewards, [
    "Volt Prime Chassis",
    "Volt Prime Neuroptics",
  ]);
  assertEquals(events[1].chosen, 1);
  assertEquals(events[1].ts, Date.UTC(2026, 8, 7, 21, 10, 1));
});

Deno.test("extractRewardEvents ignores lines without the marker", () => {
  const text = "[07/09/2026 21:09:12]   detected choice: nothing to see here";
  const events = extractRewardEvents(parseLogLines(text, anchor));
  assertEquals(events.length, 0);
});

Deno.test("extractRewardEvents keeps file order", () => {
  const text = `[07/09/2026 21:09:12]   A, detected choice: 0
[07/09/2026 21:10:01]   B || C, detected choice: 2`;
  const events = extractRewardEvents(parseLogLines(text, anchor));
  assertEquals(events.map((e) => e.rewards[0]), ["A", "B"]);
});
