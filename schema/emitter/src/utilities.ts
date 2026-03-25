
export const scalarValue: Record<string, string> = {
  "boolean": 'False',
  "float": "3.14",
  "float32": "3.14",
  "float64": "3.14",
  "number": "3.14",
  "int32": "3",
  "int64": "3",
  "integer": "3",
  "string": '"example"',
};

/**
 * Convert PascalCase to snake_case.
 * Used for idiomatic file naming in Python and Go.
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Convert PascalCase to kebab-case.
 * Used for idiomatic file naming in TypeScript.
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

export const getCombinations = (arrays: any[][]): any[][] => {
  if (arrays.length === 0) return [[]];

  const [firstArray, ...restArrays] = arrays;
  const combinationsOfRest = getCombinations(restArrays);

  return firstArray.flatMap(item =>
    combinationsOfRest.map(combination => [item, ...combination])
  );
}