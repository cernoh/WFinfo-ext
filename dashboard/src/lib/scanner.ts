/**
 * Dashboard-triggered scan runs.
 *
 * The dashboard cannot OCR by itself: a scan is the headless runner
 * (`WFInfo.Headless --scan` — capture, OCR, prices, record). This module runs
 * the configured command, one run at a time, under a deadline, and reports
 * what the command did. The runner owns every file a scan writes (`scans/`,
 * `price_cache.json`); the dashboard itself still writes nothing.
 */

/** A first run compiles the runner, so the default deadline is generous. */
export const DEFAULT_SCAN_TIMEOUT_MS = 180_000;

/** How much of the command's output is kept for the response. */
const OUTPUT_TAIL_CHARS = 4000;

export type ScanStatus = "ok" | "failed" | "timeout" | "error";

export interface ScanOutcome {
  /** `ok` only when the command exited 0 within the deadline. */
  status: ScanStatus;
  /** Exit code, or null when the command never ran to completion. */
  exitCode: number | null;
  durationMs: number;
  /** Tail of the combined stdout and stderr. */
  output: string;
}

export interface ScannerOptions {
  /** Shell command that runs one scan. */
  command: string;
  /** Deadline for one run; the process is killed when it passes. */
  timeoutMs?: number;
}

export class Scanner {
  readonly command: string;
  readonly timeoutMs: number;
  #running: Promise<ScanOutcome> | null = null;

  constructor(options: ScannerOptions) {
    this.command = options.command.trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  }

  /** True while a run holds the scanner. */
  get busy(): boolean {
    return this.#running !== null;
  }

  /**
   * Run one scan. Callers test `busy` first: two runs at once would capture
   * the screen twice and race on the scan record.
   */
  run(): Promise<ScanOutcome> {
    if (this.#running !== null) {
      throw new Error("a scan is already running");
    }
    const startedMs = Date.now();
    const running = this.#execute(startedMs).finally(() => {
      this.#running = null;
    });
    this.#running = running;
    return running;
  }

  async #execute(startedMs: number): Promise<ScanOutcome> {
    const outcome = (
      status: ScanStatus,
      exitCode: number | null,
      output: string,
    ): ScanOutcome => {
      const text = output.trim();
      return {
        status,
        exitCode,
        durationMs: Date.now() - startedMs,
        output: text.length <= OUTPUT_TAIL_CHARS
          ? text
          : `…${text.slice(-OUTPUT_TAIL_CHARS)}`,
      };
    };

    let child: Deno.ChildProcess;
    try {
      child = new Deno.Command("sh", {
        args: ["-c", this.command],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
    } catch (err) {
      return outcome(
        "error",
        null,
        err instanceof Error ? err.message : `${err}`,
      );
    }

    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // The command already exited; there is nothing left to stop.
      }
    }, this.timeoutMs);

    try {
      const out = await child.output();
      const decoder = new TextDecoder();
      const text = `${decoder.decode(out.stdout)}\n${
        decoder.decode(out.stderr)
      }`;
      if (timedOut) return outcome("timeout", out.code, text);
      return outcome(out.code === 0 ? "ok" : "failed", out.code, text);
    } catch (err) {
      return outcome(
        "error",
        null,
        err instanceof Error ? err.message : `${err}`,
      );
    } finally {
      clearTimeout(deadline);
    }
  }
}
