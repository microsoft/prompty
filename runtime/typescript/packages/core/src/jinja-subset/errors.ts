export class TemplateSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateSyntaxError";
  }
}

export class StrictViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrictViolationError";
  }
}
