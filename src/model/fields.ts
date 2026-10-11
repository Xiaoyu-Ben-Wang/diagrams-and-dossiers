/**
 * Readers for values that arrive as `unknown`: a board file off disk, a row off
 * the wire. A reader throws with the field's path, because that message is what
 * a person sees when something is wrong; the `optional*` readers answer with a
 * fallback instead, which is how an older payload reads under today's defaults.
 *
 * The prefix is bound once per parser so a failure says which of them it was.
 */
export function fieldReaders(prefix: string) {
  function fail(where: string, expected: string): never {
    throw new Error(`${prefix}: ${where} is not ${expected}.`);
  }

  function asRecord(value: unknown, where: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail(where, "an object");
    }
    return value as Record<string, unknown>;
  }

  function array(value: unknown, where: string): unknown[] {
    if (!Array.isArray(value)) fail(where, "a list");
    return value;
  }

  function number(value: unknown, where: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(where, "a number");
    }
    return value;
  }

  function text(value: unknown, where: string): string {
    if (typeof value !== "string") fail(where, "text");
    return value;
  }

  function optionalText(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
  }

  function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  function oneOf<T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
  ): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
  }

  /** `asRecord`, under the name the entity parsers read better with. */
  function record(value: unknown, where: string): Record<string, unknown> {
    return asRecord(value, where);
  }

  return {
    fail,
    asRecord,
    array,
    number,
    text,
    optionalText,
    optionalNumber,
    oneOf,
    record,
  };
}
