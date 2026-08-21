package com.microsoft.prompty.jinjasubset;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class Tokenizer {
  enum Type { TEXT, EXPR, STMT, COMMENT }

  static final class Token {
    final Type type;
    String value;
    final boolean trimLeft;
    final boolean trimRight;

    Token(Type type, String value) { this(type, value, false, false); }

    Token(Type type, String value, boolean trimLeft, boolean trimRight) {
      this.type = type;
      this.value = value;
      this.trimLeft = trimLeft;
      this.trimRight = trimRight;
    }
  }

  private record Opener(Type type, String close) {}

  private static final Map<String, Opener> OPENERS = new HashMap<>();

  static {
    OPENERS.put("{{", new Opener(Type.EXPR, "}}"));
    OPENERS.put("{%", new Opener(Type.STMT, "%}"));
    OPENERS.put("{#", new Opener(Type.COMMENT, "#}"));
  }

  private Tokenizer() {}

  static List<Token> tokenize(String template) {
    String src = template == null ? "" : template;
    List<Token> raw = new ArrayList<>();
    int i = 0;
    int textStart = 0;
    while (i < src.length()) {
      String two = i + 2 <= src.length() ? src.substring(i, i + 2) : "";
      Opener opener = OPENERS.get(two);
      if (opener != null) {
        if (i > textStart) {
          raw.add(new Token(Type.TEXT, src.substring(textStart, i)));
        }
        int closeIdx = src.indexOf(opener.close(), i + 2);
        if (closeIdx < 0) {
          throw new TemplateSyntaxException("Unclosed '" + two + "' tag at offset " + i);
        }
        String inner = src.substring(i + 2, closeIdx);
        boolean trimLeft = inner.startsWith("-");
        boolean trimRight = inner.endsWith("-");
        if (trimLeft) inner = inner.substring(1);
        if (trimRight) inner = inner.substring(0, inner.length() - 1);
        raw.add(new Token(opener.type(), opener.type() == Type.COMMENT ? "" : inner.trim(), trimLeft, trimRight));
        i = closeIdx + opener.close().length();
        textStart = i;
      } else {
        i++;
      }
    }
    if (textStart < src.length()) {
      raw.add(new Token(Type.TEXT, src.substring(textStart)));
    }
    applyTrims(raw);
    List<Token> result = new ArrayList<>();
    for (Token token : raw) {
      if (token.type != Type.COMMENT) result.add(token);
    }
    return result;
  }

  private static void applyTrims(List<Token> tokens) {
    for (int i = 0; i < tokens.size(); i++) {
      Token token = tokens.get(i);
      if (token.type == Type.TEXT) continue;
      if (token.trimLeft && i > 0 && tokens.get(i - 1).type == Type.TEXT) {
        tokens.get(i - 1).value = rstrip(tokens.get(i - 1).value);
      }
      if (token.trimRight && i + 1 < tokens.size() && tokens.get(i + 1).type == Type.TEXT) {
        tokens.get(i + 1).value = lstrip(tokens.get(i + 1).value);
      }
    }
  }

  private static String lstrip(String value) {
    int i = 0;
    while (i < value.length() && Character.isWhitespace(value.charAt(i))) i++;
    return value.substring(i);
  }

  private static String rstrip(String value) {
    int i = value.length();
    while (i > 0 && Character.isWhitespace(value.charAt(i - 1))) i--;
    return value.substring(0, i);
  }
}
