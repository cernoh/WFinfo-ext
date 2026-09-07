/**
 * Extracts "recently seen" reward-screen events from WFInfo log lines.
 *
 * When a fissure reward session ends and auto-processing is on, Data.cs logs
 * one line per reward screen:
 *
 *   "Loki Prime Systems Blueprint || Forma, detected choice: 0"
 *
 * (tokens joined with " || ", followed by ", detected choice: <index>").
 * The timestamp prefix is parsed separately by fsdata.parseLogTimestamp.
 */

import type { LogEntry } from "./fsdata.ts";

export interface RewardLogEvent {
  /** Epoch ms (may be null when the prefix was not a parseable timestamp). */
  ts: number | null;
  /** Raw bracket prefix for display, e.g. "[07/09/2026 21:09:12]". */
  tsText: string;
  /** Index of the reward the player selected. */
  chosen: number;
  /** Item names exactly as OCR reported them. */
  rewards: string[];
}

const REWARD_LINE_RE = /^(.*),\s*detected choice:\s*(\d+)\s*$/;

export function extractRewardEvents(entries: LogEntry[]): RewardLogEvent[] {
  const out: RewardLogEvent[] = [];
  for (const entry of entries) {
    const m = REWARD_LINE_RE.exec(entry.message);
    if (!m) continue;
    const tokens = m[1].split("||").map((t) => t.trim()).filter((t) =>
      t.length > 0
    );
    if (tokens.length === 0) continue;
    out.push({
      ts: entry.ts,
      tsText: entry.tsText,
      chosen: Number(m[2]),
      rewards: tokens,
    });
  }
  return out;
}
