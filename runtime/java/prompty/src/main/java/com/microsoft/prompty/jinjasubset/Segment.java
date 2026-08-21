package com.microsoft.prompty.jinjasubset;

/** A provenance-tagged rendered output segment. */
public final class Segment {
  public final String kind;
  public final String text;
  public final String source;
  public final boolean strict;

  public Segment(String kind, String text, String source, boolean strict) {
    this.kind = kind;
    this.text = text;
    this.source = source;
    this.strict = strict;
  }

  public String kind() { return kind; }
  public String text() { return text; }
  public String source() { return source; }
  public boolean strict() { return strict; }

  public String getKind() { return kind; }
  public String getText() { return text; }
  public String getSource() { return source; }
  public boolean isStrict() { return strict; }
}
