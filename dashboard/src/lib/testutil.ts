/**
 * Zero-dependency assertion helpers so unit tests never import remote or
 * package modules (keeps `nix flake check` derivations fully offline).
 */

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (!deepEqual(actual, expected)) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    throw new Error(
      `assertion failed${
        msg ? ` — ${msg}` : ""
      }\n  actual:   ${a}\n  expected: ${e}`,
    );
  }
}

export function assertTrue(value: unknown, msg?: string): void {
  if (!value) throw new Error(`assertion failed${msg ? ` — ${msg}` : ""}`);
}

export function assertMatch(actual: string, re: RegExp, msg?: string): void {
  if (!re.test(actual)) {
    throw new Error(
      `assertion failed${
        msg ? ` — ${msg}` : ""
      }: "${actual}" does not match ${re}`,
    );
  }
}

export function assertStringIncludes(
  actual: string,
  part: string,
  msg?: string,
): void {
  if (!actual.includes(part)) {
    throw new Error(
      `assertion failed${
        msg ? ` — ${msg}` : ""
      }: "${actual}" does not include "${part}"`,
    );
  }
}

/** Structural equality over JSON-comparable values (objects, arrays, primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
      if (!deepEqual(ao[ak[i]], bo[bk[i]])) return false;
    }
    return true;
  }
  return false;
}
