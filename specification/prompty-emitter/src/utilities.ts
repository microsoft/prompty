
export const scalarValue: Record<string, string> = {
  "boolean": 'False',
  "float": "3.14",
  "integer": "3",
  "string": '"example"',
};

export const getCombinations = (arrays: any[][]): any[][] => {
  if (arrays.length === 0) return [[]];

  const [firstArray, ...restArrays] = arrays;
  const combinationsOfRest = getCombinations(restArrays);

  return firstArray.flatMap(item =>
    combinationsOfRest.map(combination => [item, ...combination])
  );
}