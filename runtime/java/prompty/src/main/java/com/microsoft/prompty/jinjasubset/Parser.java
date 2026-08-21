package com.microsoft.prompty.jinjasubset;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@SuppressWarnings("auxiliaryclass")
final class Parser {
  private Parser() {}

  static List<Node> parseTemplate(String template) {
    return new TemplateParser(Tokenizer.tokenize(template)).parse();
  }

  private enum ETokKind { STRING, NUMBER, OP, KEYWORD, NAME }

  private record ETok(ETokKind kind, Object value) {}

  private static final Set<String> TWO_CHAR_OPS = Set.of("==", "!=", "<=", ">=");
  private static final String ONE_CHAR_OPS = "()[].,|<>";
  private static final Set<String> KEYWORDS = Set.of("and", "or", "not", "in", "true", "false", "null");

  private static List<ETok> lexExpr(String src) {
    List<ETok> toks = new ArrayList<>();
    int i = 0;
    while (i < src.length()) {
      char c = src.charAt(i);
      if (Character.isWhitespace(c)) { i++; continue; }
      if (c == '\'' || c == '"') {
        char quote = c;
        i++;
        StringBuilder buf = new StringBuilder();
        while (i < src.length() && src.charAt(i) != quote) {
          if (src.charAt(i) == '\\' && i + 1 < src.length()) {
            buf.append(src.charAt(i + 1));
            i += 2;
          } else {
            buf.append(src.charAt(i++));
          }
        }
        if (i >= src.length()) throw new TemplateSyntaxException("Unterminated string in expression: " + src);
        i++;
        toks.add(new ETok(ETokKind.STRING, buf.toString()));
        continue;
      }
      if (Character.isDigit(c) || (c == '-' && i + 1 < src.length() && Character.isDigit(src.charAt(i + 1)))) {
        int j = i + 1;
        while (j < src.length() && (Character.isDigit(src.charAt(j)) || src.charAt(j) == '.')) j++;
        String num = src.substring(i, j);
        Object value = num.contains(".") ? Double.valueOf(num) : Long.valueOf(num);
        toks.add(new ETok(ETokKind.NUMBER, value));
        i = j;
        continue;
      }
      if (Character.isLetter(c) || c == '_') {
        int j = i + 1;
        while (j < src.length() && (Character.isLetterOrDigit(src.charAt(j)) || src.charAt(j) == '_')) j++;
        String word = src.substring(i, j);
        toks.add(new ETok(KEYWORDS.contains(word) ? ETokKind.KEYWORD : ETokKind.NAME, word));
        i = j;
        continue;
      }
      if (i + 2 <= src.length()) {
        String two = src.substring(i, i + 2);
        if (TWO_CHAR_OPS.contains(two)) {
          toks.add(new ETok(ETokKind.OP, two));
          i += 2;
          continue;
        }
      }
      if (ONE_CHAR_OPS.indexOf(c) >= 0) {
        toks.add(new ETok(ETokKind.OP, String.valueOf(c)));
        i++;
        continue;
      }
      throw new TemplateSyntaxException("Unexpected character '" + c + "' in expression: " + src);
    }
    return toks;
  }

  private static Expr parseExpression(String src) {
    return new ExprParser(lexExpr(src), src).parse();
  }

  private static final class ExprParser {
    private final List<ETok> toks;
    private final String src;
    private int pos;

    ExprParser(List<ETok> toks, String src) { this.toks = toks; this.src = src; }
    private ETok peek() { return pos < toks.size() ? toks.get(pos) : null; }
    private ETok next() { return toks.get(pos++); }
    private boolean is(ETokKind kind, Object value) {
      ETok t = peek();
      return t != null && t.kind() == kind && t.value().equals(value);
    }

    Expr parse() {
      Expr expr = parseOr();
      if (pos != toks.size()) throw new TemplateSyntaxException("Trailing tokens in expression: " + src);
      return expr;
    }

    private Expr parseOr() {
      Expr left = parseAnd();
      while (is(ETokKind.KEYWORD, "or")) { next(); left = new BinaryExpr("or", left, parseAnd()); }
      return left;
    }

    private Expr parseAnd() {
      Expr left = parseNot();
      while (is(ETokKind.KEYWORD, "and")) { next(); left = new BinaryExpr("and", left, parseNot()); }
      return left;
    }

    private Expr parseNot() {
      if (is(ETokKind.KEYWORD, "not")) { next(); return new UnaryExpr("not", parseNot()); }
      return parseComparison();
    }

    private Expr parseComparison() {
      Expr left = parseFilter();
      ETok t = peek();
      if (t != null && t.kind() == ETokKind.OP && (t.value().equals("==") || t.value().equals("!=")
          || t.value().equals("<") || t.value().equals(">") || t.value().equals("<=") || t.value().equals(">="))) {
        String op = (String) next().value();
        return new BinaryExpr(op, left, parseFilter());
      }
      if (is(ETokKind.KEYWORD, "in")) { next(); return new BinaryExpr("in", left, parseFilter()); }
      return left;
    }

    private Expr parseFilter() {
      Expr expr = parsePrimary();
      while (is(ETokKind.OP, "|")) {
        next();
        ETok nameTok = peek();
        if (nameTok == null || nameTok.kind() != ETokKind.NAME) {
          throw new TemplateSyntaxException("Expected filter name in: " + src);
        }
        String name = (String) next().value();
        List<Expr> args = new ArrayList<>();
        if (is(ETokKind.OP, "(")) {
          next();
          if (!is(ETokKind.OP, ")")) {
            args.add(parseOr());
            while (is(ETokKind.OP, ",")) { next(); args.add(parseOr()); }
          }
          if (!is(ETokKind.OP, ")")) throw new TemplateSyntaxException("Unclosed filter args in: " + src);
          next();
        }
        expr = new FilterExpr(name, expr, args);
      }
      return expr;
    }

    private Expr parsePrimary() {
      ETok t = peek();
      if (t == null) throw new TemplateSyntaxException("Unexpected end of expression: " + src);
      if (t.kind() == ETokKind.OP && t.value().equals("(")) {
        next();
        Expr expr = parseOr();
        if (!is(ETokKind.OP, ")")) throw new TemplateSyntaxException("Unclosed parenthesis in: " + src);
        next();
        return expr;
      }
      if (t.kind() == ETokKind.STRING) { next(); return new LitExpr(t.value()); }
      if (t.kind() == ETokKind.NUMBER) { next(); return new LitExpr(t.value()); }
      if (t.kind() == ETokKind.KEYWORD && (t.value().equals("true") || t.value().equals("false") || t.value().equals("null"))) {
        next();
        return new LitExpr(t.value().equals("true") ? Boolean.TRUE : t.value().equals("false") ? Boolean.FALSE : null);
      }
      if (t.kind() == ETokKind.NAME) return parseAccessor();
      throw new TemplateSyntaxException("Unexpected token '" + t.value() + "' in expression: " + src);
    }

    private Expr parseAccessor() {
      String root = (String) next().value();
      List<PathSeg> path = new ArrayList<>();
      while (true) {
        if (is(ETokKind.OP, ".")) {
          next();
          ETok attrTok = peek();
          if (attrTok == null || (attrTok.kind() != ETokKind.NAME && attrTok.kind() != ETokKind.KEYWORD)) {
            throw new TemplateSyntaxException("Expected attribute name in: " + src);
          }
          path.add(new AttrSeg((String) next().value()));
        } else if (is(ETokKind.OP, "[")) {
          next();
          Expr indexExpr = parseOr();
          if (!is(ETokKind.OP, "]")) throw new TemplateSyntaxException("Unclosed index in: " + src);
          next();
          path.add(new IndexSeg(indexExpr));
        } else {
          break;
        }
      }
      return new VarExpr(root, path);
    }
  }

  private record Stmt(String head, String rest) {}

  private static Stmt stmtHead(String inner) {
    String trimmed = inner == null ? "" : inner.trim();
    if (trimmed.isEmpty()) return new Stmt("", "");
    String[] parts = trimmed.split("\\s+", 2);
    return new Stmt(parts[0], parts.length > 1 ? parts[1] : "");
  }

  private static final class TemplateParser {
    private final List<Tokenizer.Token> tokens;
    private int pos;

    TemplateParser(List<Tokenizer.Token> tokens) { this.tokens = tokens; }
    private Tokenizer.Token peek() { return pos < tokens.size() ? tokens.get(pos) : null; }
    List<Node> parse() { return parseNodes(Set.of()); }

    private List<Node> parseNodes(Set<String> terminators) {
      List<Node> nodes = new ArrayList<>();
      while (pos < tokens.size()) {
        Tokenizer.Token tok = tokens.get(pos);
        if (tok.type == Tokenizer.Type.STMT) {
          Stmt stmt = stmtHead(tok.value);
          if (terminators.contains(stmt.head())) return nodes;
          if (stmt.head().equals("if")) { nodes.add(parseIf()); continue; }
          if (stmt.head().equals("for")) { nodes.add(parseFor()); continue; }
          throw new TemplateSyntaxException("Unexpected statement '" + tok.value + "'");
        }
        if (tok.type == Tokenizer.Type.TEXT) { pos++; nodes.add(new TextNode(tok.value)); continue; }
        if (tok.type == Tokenizer.Type.EXPR) { pos++; nodes.add(new InterpNode(parseExpression(tok.value))); continue; }
        throw new TemplateSyntaxException("Unexpected token type " + tok.type);
      }
      if (!terminators.isEmpty()) throw new TemplateSyntaxException("Unclosed block; expected one of " + terminators);
      return nodes;
    }

    private IfNode parseIf() {
      List<Branch> branches = new ArrayList<>();
      Stmt first = stmtHead(tokens.get(pos).value);
      pos++;
      branches.add(new Branch(parseExpression(first.rest()), parseNodes(Set.of("elif", "else", "endif"))));
      List<Node> elseBody = null;
      while (true) {
        Tokenizer.Token tok = peek();
        if (tok == null) throw new TemplateSyntaxException("Unclosed 'if' block");
        Stmt stmt = stmtHead(tok.value);
        if (stmt.head().equals("elif")) {
          pos++;
          branches.add(new Branch(parseExpression(stmt.rest()), parseNodes(Set.of("elif", "else", "endif"))));
        } else if (stmt.head().equals("else")) {
          pos++;
          elseBody = parseNodes(Set.of("endif"));
        } else if (stmt.head().equals("endif")) {
          pos++;
          break;
        } else {
          throw new TemplateSyntaxException("Unexpected '" + tok.value + "' in if block");
        }
      }
      return new IfNode(branches, elseBody);
    }

    private ForNode parseFor() {
      Stmt stmt = stmtHead(tokens.get(pos).value);
      pos++;
      String[] parts = stmt.rest().split("\\s+", 3);
      if (parts.length < 3 || !parts[1].equals("in")) {
        throw new TemplateSyntaxException("Malformed for statement: 'for " + stmt.rest() + "'");
      }
      List<Node> body = parseNodes(Set.of("endfor"));
      Tokenizer.Token end = peek();
      if (end == null || !stmtHead(end.value).head().equals("endfor")) {
        throw new TemplateSyntaxException("Unclosed 'for' block");
      }
      pos++;
      return new ForNode(parts[0], parseExpression(parts[2]), body);
    }
  }
}

