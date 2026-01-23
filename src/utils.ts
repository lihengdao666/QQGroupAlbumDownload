import { toRaw, isRef, isReactive, isProxy } from "vue";

export function deepToRaw<T extends Record<string, unknown>>(sourceObj: T): T {
  const objectIterator = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => objectIterator(item));
    }
    if (isRef(input) || isReactive(input) || isProxy(input)) {
      return objectIterator(toRaw(input));
    }
    if (input && typeof input === "object") {
      return Object.keys(input).reduce((acc, key) => {
        const value = objectIterator((input as Record<string, unknown>)[key]);
        (acc as Record<string, unknown>)[key] = value;
        return acc;
      }, {} as T);
    }
    return input;
  };

  return objectIterator(sourceObj) as T;
}