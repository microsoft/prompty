package com.microsoft.prompty.jinjasubset;

import java.lang.reflect.Array;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

@SuppressWarnings("auxiliaryclass")
final class Evaluator {
  private static final Pattern ROLE_BOUNDARY = Pattern.compile("^\\s*(system|user|assistant|developer)\\s*:", Pattern.CASE_INSENSITIVE | Pattern.MULTILINE);
  private static final Object UNDEFINED = new Object();

  private Evaluator() {}

  static List<Segment> renderSegments(String template, Map<String, Object> inputs, Iterable<String> strictProps) {
    Map<String, Object> scope = new LinkedHashMap<>(inputs == null ? Map.of() : inputs);
    Set<String> strict = new HashSet<>();
    if (strictProps != null) {
      for (String prop : strictProps) if (prop != null) strict.add(prop);
    }
    List<Segment> out = new ArrayList<>();
    renderNodes(Parser.parseTemplate(template), new Frame(scope, strict), out);
    return out;
  }

  static String render(String template, Map<String, Object> inputs, Iterable<String> strictProps) {
    StringBuilder sb = new StringBuilder();
    for (Segment segment : renderSegments(template, inputs, strictProps)) sb.append(segment.text());
    return sb.toString();
  }

  private record Frame(Map<String, Object> scope, Set<String> strictProps) {}

  private static boolean isInteger(Object value) {
    return value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long || value instanceof BigInteger;
  }

  private static boolean isNumeric(Object value) {
    return isInteger(value) || value instanceof Float || value instanceof Double || value instanceof BigDecimal;
  }

  private static double toDouble(Object value) {
    return ((Number) value).doubleValue();
  }

  private static long toLong(Object value) {
    if (value instanceof BigInteger bi) return bi.longValue();
    return ((Number) value).longValue();
  }

  private static boolean truthy(Object value) {
    if (value == null || value == UNDEFINED) return false;
    if (value instanceof Boolean b) return b;
    if (value instanceof String s) return !s.isEmpty();
    if (value instanceof Map<?, ?> m) return !m.isEmpty();
    if (value instanceof Collection<?> c) return !c.isEmpty();
    if (value.getClass().isArray()) return Array.getLength(value) > 0;
    if (isInteger(value)) return toLong(value) != 0L;
    if (value instanceof Number) return toDouble(value) != 0.0d;
    return true;
  }

  private static String stringify(Object value) {
    if (value == null || value == UNDEFINED) return "";
    if (value instanceof Boolean b) return b ? "true" : "false";
    if (value instanceof Float || value instanceof Double || value instanceof BigDecimal) {
      double d = toDouble(value);
      if (!Double.isInfinite(d) && !Double.isNaN(d) && d == Math.floor(d) && Math.abs(d) < 9.2e18) {
        return Long.toString((long) d);
      }
      return BigDecimal.valueOf(d).stripTrailingZeros().toPlainString();
    }
    if (isInteger(value)) return Long.toString(toLong(value));
    if (value instanceof String s) return s;
    if (value instanceof Map<?, ?> map) return dictToString(map);
    if (value instanceof Iterable<?> iterable) {
      StringBuilder sb = new StringBuilder();
      for (Object item : iterable) sb.append(stringify(item));
      return sb.toString();
    }
    if (value.getClass().isArray()) {
      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < Array.getLength(value); i++) sb.append(stringify(Array.get(value, i)));
      return sb.toString();
    }
    return String.valueOf(value);
  }

  private static String dictToString(Map<?, ?> dict) {
    StringBuilder sb = new StringBuilder("{");
    boolean first = true;
    for (Map.Entry<?, ?> entry : dict.entrySet()) {
      if (!first) sb.append(", ");
      first = false;
      sb.append('\'').append(String.valueOf(entry.getKey())).append("': ").append(stringify(entry.getValue()));
    }
    return sb.append('}').toString();
  }

  private static Object lookup(String root, Map<String, Object> scope) {
    return scope.containsKey(root) ? scope.get(root) : UNDEFINED;
  }

  private static Object access(Object value, PathSeg seg, Map<String, Object> scope) {
    if (value == null || value == UNDEFINED) return UNDEFINED;
    if (seg instanceof AttrSeg attr) {
      if (value instanceof Map<?, ?> map) return map.containsKey(attr.name) ? map.get(attr.name) : UNDEFINED;
      return UNDEFINED;
    }
    IndexSeg indexSeg = (IndexSeg) seg;
    Object index = evalExpr(indexSeg.expr, scope);
    try {
      if (value instanceof Map<?, ?> map) {
        if (index instanceof String key && map.containsKey(key)) return map.get(key);
        return UNDEFINED;
      }
      if (value instanceof List<?> list) {
        int i = toIndex(index);
        if (i < 0) i += list.size();
        return i >= 0 && i < list.size() ? list.get(i) : UNDEFINED;
      }
      if (value instanceof String s) {
        int i = toIndex(index);
        if (i < 0) i += s.length();
        return i >= 0 && i < s.length() ? String.valueOf(s.charAt(i)) : UNDEFINED;
      }
      if (value.getClass().isArray()) {
        int i = toIndex(index);
        int length = Array.getLength(value);
        if (i < 0) i += length;
        return i >= 0 && i < length ? Array.get(value, i) : UNDEFINED;
      }
    } catch (RuntimeException ignored) {
      return UNDEFINED;
    }
    return UNDEFINED;
  }

  private static int toIndex(Object index) {
    if (isInteger(index)) return Math.toIntExact(toLong(index));
    if (index instanceof Number number) return (int) number.doubleValue();
    if (index instanceof String s) return Integer.parseInt(s);
    throw new IllegalArgumentException("Non-integer index");
  }

  private static Object evalExpr(Expr expr, Map<String, Object> scope) {
    if (expr instanceof LitExpr lit) return lit.value;
    if (expr instanceof VarExpr var) {
      Object value = lookup(var.root, scope);
      for (PathSeg seg : var.path) value = access(value, seg, scope);
      return value;
    }
    if (expr instanceof FilterExpr filter) return applyFilter(filter, scope);
    if (expr instanceof UnaryExpr unary) return !truthy(evalExpr(unary.operand, scope));
    if (expr instanceof BinaryExpr binary) return evalBinary(binary, scope);
    throw new IllegalStateException("Unknown expression: " + expr.getClass().getName());
  }

  private static Object evalBinary(BinaryExpr expr, Map<String, Object> scope) {
    if (expr.operator.equals("and")) {
      Object left = evalExpr(expr.left, scope);
      return truthy(left) ? evalExpr(expr.right, scope) : left;
    }
    if (expr.operator.equals("or")) {
      Object left = evalExpr(expr.left, scope);
      return truthy(left) ? left : evalExpr(expr.right, scope);
    }
    Object left = evalExpr(expr.left, scope);
    Object right = evalExpr(expr.right, scope);
    if (expr.operator.equals("in")) return evalIn(left, right);
    Object l = left == UNDEFINED ? null : left;
    Object r = right == UNDEFINED ? null : right;
    return switch (expr.operator) {
      case "==" -> valueEquals(l, r);
      case "!=" -> !valueEquals(l, r);
      case "<", ">", "<=", ">=" -> compare(expr.operator, l, r);
      default -> throw new IllegalStateException("Unknown binary operator: " + expr.operator);
    };
  }

  private static boolean compare(String op, Object l, Object r) {
    int cmp;
    if (isNumeric(l) && isNumeric(r)) {
      cmp = Double.compare(toDouble(l), toDouble(r));
    } else if (l instanceof String ls && r instanceof String rs) {
      cmp = ls.compareTo(rs);
    } else {
      return false;
    }
    return switch (op) {
      case "<" -> cmp < 0;
      case ">" -> cmp > 0;
      case "<=" -> cmp <= 0;
      case ">=" -> cmp >= 0;
      default -> false;
    };
  }

  private static boolean evalIn(Object left, Object right) {
    if (right instanceof Map<?, ?> map) return left instanceof String key && map.containsKey(key);
    if (right instanceof Iterable<?> iterable) {
      for (Object item : iterable) if (valueEquals(item == UNDEFINED ? null : item, left == UNDEFINED ? null : left)) return true;
      return false;
    }
    if (right instanceof String s) return left instanceof String sub && s.contains(sub);
    return false;
  }

  private static boolean valueEquals(Object a, Object b) {
    if (a == null || b == null) return a == b;
    if (isNumeric(a) && isNumeric(b)) return Double.compare(toDouble(a), toDouble(b)) == 0;
    return Objects.equals(a, b);
  }

  private static Object applyFilter(FilterExpr expr, Map<String, Object> scope) {
    Object value = evalExpr(expr.input, scope);
    List<Object> args = new ArrayList<>();
    for (Expr arg : expr.args) args.add(evalExpr(arg, scope));
    return switch (expr.name) {
      case "upper" -> stringify(value).toUpperCase(java.util.Locale.ROOT);
      case "lower" -> stringify(value).toLowerCase(java.util.Locale.ROOT);
      case "trim" -> stringify(value).trim();
      case "join" -> join(value, args.isEmpty() ? "" : stringify(args.get(0)));
      case "length" -> Long.valueOf(length(value));
      case "default" -> (value == null || value == UNDEFINED) ? (args.isEmpty() ? "" : args.get(0)) : value;
      case "replace" -> replace(value, args);
      default -> throw new IllegalArgumentException("Unknown filter: " + expr.name);
    };
  }

  private static String join(Object value, String sep) {
    if (!(value instanceof Iterable<?> iterable)) return "";
    List<String> parts = new ArrayList<>();
    for (Object item : iterable) parts.add(stringify(item));
    return String.join(sep, parts);
  }

  private static long length(Object value) {
    if (value == null || value == UNDEFINED) return 0L;
    if (value instanceof String s) return s.length();
    if (value instanceof Collection<?> c) return c.size();
    if (value instanceof Map<?, ?> m) return m.size();
    if (value.getClass().isArray()) return Array.getLength(value);
    return 0L;
  }

  private static String replace(Object value, List<Object> args) {
    if (args.size() < 2) throw new IllegalArgumentException("replace filter requires (old, new) arguments");
    String subject = stringify(value);
    String oldValue = stringify(args.get(0));
    return oldValue.isEmpty() ? subject : subject.replace(oldValue, stringify(args.get(1)));
  }

  private static List<Object> iterSeq(Object value) {
    List<Object> result = new ArrayList<>();
    if (value == null || value == UNDEFINED) return result;
    if (value instanceof Map<?, ?> map) {
      result.addAll(map.keySet());
    } else if (value instanceof Iterable<?> iterable) {
      for (Object item : iterable) result.add(item);
    } else if (value instanceof String s) {
      for (int i = 0; i < s.length(); i++) result.add(String.valueOf(s.charAt(i)));
    } else if (value.getClass().isArray()) {
      for (int i = 0; i < Array.getLength(value); i++) result.add(Array.get(value, i));
    }
    return result;
  }

  private static String interpSource(Expr expr) {
    return expr instanceof VarExpr var ? var.root : null;
  }

  private static void renderNodes(List<Node> nodes, Frame frame, List<Segment> out) {
    for (Node node : nodes) {
      if (node instanceof TextNode text) {
        addLiteral(out, text.value);
      } else if (node instanceof InterpNode interp) {
        Object value = evalExpr(interp.expr, frame.scope());
        String text = stringify(value);
        String source = interpSource(interp.expr);
        boolean strict = source != null && frame.strictProps().contains(source);
        if (strict && ROLE_BOUNDARY.matcher(text).find()) {
          throw new StrictViolationException("strict input '" + source + "' produced a forged role boundary: " + text);
        }
        if (!text.isEmpty()) out.add(new Segment("interp", text, source, strict));
      } else if (node instanceof IfNode iff) {
        renderIf(iff, frame, out);
      } else if (node instanceof ForNode forn) {
        renderFor(forn, frame, out);
      } else {
        throw new IllegalStateException("Unknown node: " + node.getClass().getName());
      }
    }
  }

  private static void addLiteral(List<Segment> out, String text) {
    if (text == null || text.isEmpty()) return;
    if (!out.isEmpty()) {
      Segment last = out.get(out.size() - 1);
      if ("literal".equals(last.kind())) {
        out.set(out.size() - 1, new Segment("literal", last.text() + text, null, false));
        return;
      }
    }
    out.add(new Segment("literal", text, null, false));
  }

  private static void renderIf(IfNode node, Frame frame, List<Segment> out) {
    for (Branch branch : node.branches) {
      if (truthy(evalExpr(branch.test, frame.scope()))) {
        renderNodes(branch.body, frame, out);
        return;
      }
    }
    if (node.elseBody != null) renderNodes(node.elseBody, frame, out);
  }

  private static void renderFor(ForNode node, Frame frame, List<Segment> out) {
    List<Object> items = iterSeq(evalExpr(node.seq, frame.scope()));
    int total = items.size();
    for (int i = 0; i < total; i++) {
      Map<String, Object> child = new LinkedHashMap<>(frame.scope());
      child.put(node.loopVar, items.get(i));
      Map<String, Object> loop = new HashMap<>();
      loop.put("index", Long.valueOf(i + 1L));
      loop.put("index0", Long.valueOf(i));
      loop.put("first", i == 0);
      loop.put("last", i == total - 1);
      loop.put("length", Long.valueOf(total));
      child.put("loop", loop);
      renderNodes(node.body, new Frame(child, frame.strictProps()), out);
    }
  }
}

