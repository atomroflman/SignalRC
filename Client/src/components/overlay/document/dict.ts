// Document keys are user data: ids like "constructor" or "__proto__" must not
// hit Object.prototype. Inputs are copied into prototype-less objects before
// any lookup, and result maps are created without a prototype.

export function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Deep copy with prototype-less objects; arrays stay arrays. */
export function detach<T>(value: T): T {
  if (Array.isArray(value)) return value.map(detach) as T;
  if (value === null || typeof value !== "object") return value;
  const copy = dict<unknown>();
  for (const [k, v] of Object.entries(value)) copy[k] = detach(v);
  return copy as T;
}
