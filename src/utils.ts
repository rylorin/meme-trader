/**
 * @internal
 *
 * JSON replace function to convert ES6 Maps to tuple arrays.
 */
function jsonReplacer(key: string, value: any): any {
  if (value instanceof Map) {
    const tuples: [unknown, unknown][] = [];
    value.forEach((v, k) => {
      tuples.push([k, v]);
    });
    return tuples;
  } else {
    return value;
  }
}

/**
 * Convert an object (JSON formatted) to string.
 */
export function formatObject(obj: unknown): string {
  return `${JSON.stringify(obj, jsonReplacer, 2)}`;
}

export function string2boolean(text: string | boolean): boolean {
  if (typeof text == "boolean") return text;
  const bool: string = text.trim().toLowerCase();
  return bool == "true" || bool == "on" || bool == "yes";
}
