/**
 * Minimal runtime validation for JSON data files. Each validator returns the
 * typed value or throws a ConfigError naming the offending path, so a typo in
 * a data file fails loudly at boot instead of producing NaN physics.
 */
export class ConfigError extends Error {}

export type Validator<T> = (v: unknown, path: string) => T;

const fail = (path: string, what: string, v: unknown): never => {
  throw new ConfigError(`${path}: expected ${what}, got ${JSON.stringify(v)}`);
};

export const num =
  (min = -Infinity, max = Infinity): Validator<number> =>
  (v, p) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(p, `number in [${min}, ${max}]`, v);

export const str: Validator<string> = (v, p) => (typeof v === 'string' ? v : fail(p, 'string', v));

export const bool: Validator<boolean> = (v, p) => (typeof v === 'boolean' ? v : fail(p, 'boolean', v));

export const oneOf =
  <T extends string | number>(...values: T[]): Validator<T> =>
  (v, p) =>
    values.includes(v as T) ? (v as T) : fail(p, `one of ${values.join(' | ')}`, v);

export const arr =
  <T>(item: Validator<T>): Validator<T[]> =>
  (v, p) =>
    Array.isArray(v) ? v.map((x, i) => item(x, `${p}[${i}]`)) : fail(p, 'array', v);

export const record =
  <T>(item: Validator<T>): Validator<Record<string, T>> =>
  (v, p) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(p, 'object', v);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, item(x, `${p}.${k}`)]));
  };

export const optional =
  <T>(item: Validator<T>): Validator<T | undefined> =>
  (v, p) =>
    v === undefined ? undefined : item(v, p);

type Shape = Record<string, Validator<unknown>>;
type FromShape<S extends Shape> = { [K in keyof S]: ReturnType<S[K]> };

/** Object with exactly the given keys (unknown keys are rejected to catch typos). */
export const obj =
  <S extends Shape>(shape: S): Validator<FromShape<S>> =>
  (v, p) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(p, 'object', v);
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!(k in shape)) throw new ConfigError(`${p}.${k}: unknown key`);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(shape)) out[k] = val(o[k], `${p}.${k}`);
    return out as FromShape<S>;
  };
