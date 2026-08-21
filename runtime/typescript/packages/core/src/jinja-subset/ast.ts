export type Expr =
  | { kind: "lit"; value: unknown }
  | { kind: "var"; root: string; path: PathSeg[] }
  | { kind: "filter"; name: string; input: Expr; args: Expr[] }
  | { kind: "unary"; operator: "not"; operand: Expr }
  | { kind: "binary"; operator: string; left: Expr; right: Expr };

export type PathSeg =
  { kind: "attr"; name: string } | { kind: "index"; expr: Expr };

export type Node =
  | { kind: "text"; value: string }
  | { kind: "interp"; expr: Expr }
  | { kind: "if"; branches: Branch[]; elseBody?: Node[] }
  | { kind: "for"; loopVar: string; seq: Expr; body: Node[] };

export interface Branch {
  test: Expr;
  body: Node[];
}
