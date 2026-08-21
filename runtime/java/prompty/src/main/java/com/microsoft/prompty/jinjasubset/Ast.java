package com.microsoft.prompty.jinjasubset;

import java.util.ArrayList;
import java.util.List;

abstract class Expr {}

final class LitExpr extends Expr {
  final Object value;
  LitExpr(Object value) { this.value = value; }
}

abstract class PathSeg {}

final class AttrSeg extends PathSeg {
  final String name;
  AttrSeg(String name) { this.name = name; }
}

final class IndexSeg extends PathSeg {
  final Expr expr;
  IndexSeg(Expr expr) { this.expr = expr; }
}

final class VarExpr extends Expr {
  final String root;
  final List<PathSeg> path;
  VarExpr(String root, List<PathSeg> path) { this.root = root; this.path = path; }
}

final class FilterExpr extends Expr {
  final String name;
  final Expr input;
  final List<Expr> args;
  FilterExpr(String name, Expr input, List<Expr> args) {
    this.name = name;
    this.input = input;
    this.args = args;
  }
}

final class UnaryExpr extends Expr {
  final String operator;
  final Expr operand;
  UnaryExpr(String operator, Expr operand) { this.operator = operator; this.operand = operand; }
}

final class BinaryExpr extends Expr {
  final String operator;
  final Expr left;
  final Expr right;
  BinaryExpr(String operator, Expr left, Expr right) {
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

abstract class Node {}

final class TextNode extends Node {
  final String value;
  TextNode(String value) { this.value = value; }
}

final class InterpNode extends Node {
  final Expr expr;
  InterpNode(Expr expr) { this.expr = expr; }
}

final class Branch {
  final Expr test;
  final List<Node> body;
  Branch(Expr test, List<Node> body) { this.test = test; this.body = body; }
}

final class IfNode extends Node {
  final List<Branch> branches;
  final List<Node> elseBody;
  IfNode(List<Branch> branches, List<Node> elseBody) { this.branches = branches; this.elseBody = elseBody; }
}

final class ForNode extends Node {
  final String loopVar;
  final Expr seq;
  final List<Node> body;
  ForNode(String loopVar, Expr seq, List<Node> body) {
    this.loopVar = loopVar;
    this.seq = seq;
    this.body = body;
  }
}
