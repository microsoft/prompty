import "../dist/src/decorators.js";
using TypeSpec.Reflection;

extern dec resolve(
  target: Union,
  name: valueof string,
  type: Model,
  docsOnly?: valueof boolean
);
