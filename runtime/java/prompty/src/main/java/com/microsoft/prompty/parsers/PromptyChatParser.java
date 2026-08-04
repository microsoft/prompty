package com.microsoft.prompty.parsers;

import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.Nonces;
import com.microsoft.prompty.Parser;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.Role;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Splits rendered text into messages at role-marker lines.
 *
 * <p>A role marker is a line that, once trimmed, is nothing but {@code system:}, {@code user:} or
 * {@code assistant:} — optionally prefixed with {@code #} and optionally carrying an attribute block
 * such as {@code user[name="Alice"]:}. Requiring the marker to occupy the whole line is what lets
 * ordinary prose like "The user: said hello" stay content.
 *
 * <p>Registered under {@code prompty}.
 *
 * <h2>Strict mode</h2>
 *
 * <p>Role markers are the only structural authority in a rendered prompt, so a template variable
 * that happens to contain {@code "user:"} could otherwise forge a turn boundary. Strict mode closes
 * that hole: {@link #preRender} stamps every marker that was genuinely present in the template with
 * a random nonce, and parsing then rejects any marker that cannot produce it. Injected text cannot
 * guess the nonce, so an injected marker is detected rather than obeyed.
 */
public final class PromptyChatParser implements Parser {

  /**
   * Matches a role marker line, with an optional attribute block.
   *
   * <p>The attribute loop is written to be unambiguous, because Java's regex engine backtracks. A
   * value is either a quoted run or a run containing no quote, comma or {@code ]}, so no character
   * can be attributed to two different iterations of the loop, and the possessive quantifiers stop
   * the engine from ever trying. The obvious formulation — a single {@code "?[^"]*"?} value class —
   * lets the value swallow the separator and the closing bracket, which makes an unterminated block
   * such as {@code user[a= a= a= …} split in exponentially many ways and hang the matcher.
   *
   * <p>The Rust, Python and TypeScript runtimes all carry that formulation. Rust is safe only by
   * accident: its {@code regex} crate is a non-backtracking automaton. Python and TypeScript use
   * backtracking engines and appear to share this exposure. C# is unaffected — it matches the block
   * as a single lazy group instead.
   */
  private static final Pattern BOUNDARY =
      Pattern.compile(
          "^\\s*#?\\s*(system|user|assistant)"
              + "(\\[(?:\\w++\\s*+=\\s*+(?:\"[^\"]*+\"|[^\",\\]]*+)\\s*+,?\\s*+)+\\])?"
              + "\\s*:\\s*$",
          Pattern.CASE_INSENSITIVE);

  private static final Pattern ATTRIBUTE = Pattern.compile("(\\w+)\\s*=\\s*\"?([^\",\\]]*)\"?");

  /** Metadata key under which {@link #preRender} returns the nonce it stamped. */
  public static final String NONCE_KEY = "nonce";

  @Override
  public java.util.Optional<PreRender> preRender(String template) {
    String nonce = Nonces.hex(16);

    String[] lines = template.split("\n", -1);
    StringBuilder sanitized = new StringBuilder();
    for (int i = 0; i < lines.length; i++) {
      if (i > 0) {
        sanitized.append('\n');
      }
      Matcher matcher = BOUNDARY.matcher(lines[i].trim());
      if (matcher.matches()) {
        // The trailing newline mirrors the other runtimes byte for byte. It produces a blank
        // content line, which the content trim then discards.
        sanitized
            .append(matcher.group(1).toLowerCase(java.util.Locale.ROOT))
            .append("[nonce=\"")
            .append(nonce)
            .append("\"]:\n");
      } else {
        sanitized.append(lines[i]);
      }
    }

    return java.util.Optional.of(new PreRender(sanitized.toString(), Map.of(NONCE_KEY, nonce)));
  }

  @Override
  public List<Message> parse(Prompty agent, String rendered, Map<String, Object> context) {
    String nonce = null;
    if (context != null && context.get(NONCE_KEY) instanceof String value) {
      nonce = value;
    }
    return parseChat(rendered, nonce);
  }

  /** Parse rendered text without nonce validation. */
  public static List<Message> parseChat(String rendered) {
    return parseChat(rendered, null);
  }

  /**
   * Parse rendered text into messages, optionally enforcing an expected nonce.
   *
   * @param expectedNonce the nonce every role marker must carry, or null to skip validation
   * @throws InvokerException with {@link InvokerException.Kind#PARSE} on a nonce mismatch
   */
  public static List<Message> parseChat(String rendered, String expectedNonce) {
    List<Message> messages = new ArrayList<>();
    Role currentRole = Role.SYSTEM;
    List<String> contentLines = new ArrayList<>();
    Map<String, Object> currentAttributes = new LinkedHashMap<>();
    boolean sawRoleMarker = false;

    for (String line : rendered.split("\n", -1)) {
      Matcher matcher = BOUNDARY.matcher(line.trim());
      if (!matcher.matches()) {
        contentLines.add(line);
        continue;
      }

      // A marker closes the preceding message. Content accumulated before the very first marker
      // still becomes a message, which is how a prompt with no markers at all parses as system.
      if (!contentLines.isEmpty() || sawRoleMarker) {
        messages.add(
            buildMessage(
                currentRole,
                joinAndTrim(contentLines),
                currentAttributes,
                sawRoleMarker ? expectedNonce : null));
        contentLines.clear();
        currentAttributes = new LinkedHashMap<>();
      }

      currentRole = roleOf(matcher.group(1));
      currentAttributes =
          matcher.group(2) == null ? new LinkedHashMap<>() : parseAttributes(matcher.group(2));
      sawRoleMarker = true;
    }

    if (!contentLines.isEmpty() || sawRoleMarker) {
      messages.add(
          buildMessage(
              currentRole,
              joinAndTrim(contentLines),
              currentAttributes,
              sawRoleMarker ? expectedNonce : null));
    }

    return messages;
  }

  private static Message buildMessage(
      Role role, String content, Map<String, Object> attributes, String expectedNonce) {
    if (expectedNonce != null) {
      Object raw = attributes.get(NONCE_KEY);
      // Nonces are captured verbatim (see parseAttributes), so this is a plain text comparison.
      String actual = raw == null ? "" : String.valueOf(raw);
      if (!expectedNonce.equals(actual)) {
        throw InvokerException.parse(
            "Nonce mismatch — possible prompt injection detected (strict mode is enabled)."
                + " A template variable may be injecting role markers.");
      }
    }

    Message message = Messages.withText(role, content);
    for (Map.Entry<String, Object> entry : attributes.entrySet()) {
      if (!NONCE_KEY.equals(entry.getKey())) {
        message.metadata.put(entry.getKey(), entry.getValue());
      }
    }
    return message;
  }

  /**
   * Resolve a captured role name.
   *
   * <p>Matching is case-insensitive to agree with the boundary pattern, which already accepts
   * {@code User:} as a marker; treating it as a marker but not as a user turn would be incoherent.
   */
  private static Role roleOf(String captured) {
    try {
      return Role.fromValue(captured.toLowerCase(java.util.Locale.ROOT));
    } catch (IllegalArgumentException e) {
      return Role.SYSTEM;
    }
  }

  /** Extract {@code key=value} pairs from an attribute block such as {@code [name="Alice"]}. */
  private static Map<String, Object> parseAttributes(String block) {
    Map<String, Object> attributes = new LinkedHashMap<>();
    Matcher matcher = ATTRIBUTE.matcher(block);
    while (matcher.find()) {
      String key = matcher.group(1);
      String value = matcher.group(2).trim();
      // The nonce is an opaque token, not data. Coercing it loses leading zeros on the roughly
      // one-in-eighteen-thousand nonce that comes out all digits, which would then fail to match
      // the nonce that was stamped and reject a legitimate render as a prompt injection. The Rust
      // reference converts the coerced number back to text, which does not restore the lost zero,
      // so it still carries this fault; capturing the nonce verbatim avoids it outright.
      attributes.put(key, NONCE_KEY.equals(key) ? value : coerce(value));
    }
    return attributes;
  }

  /** Coerce an attribute value to boolean, integer or double where it parses cleanly. */
  private static Object coerce(String raw) {
    if ("true".equalsIgnoreCase(raw)) {
      return Boolean.TRUE;
    }
    if ("false".equalsIgnoreCase(raw)) {
      return Boolean.FALSE;
    }
    try {
      return Long.valueOf(raw);
    } catch (NumberFormatException ignored) {
      // Not an integer; fall through to the floating-point attempt.
    }
    try {
      // Java accepts forms JSON does not — "0x1p3", "1d", "NaN" — so require a plain decimal.
      if (raw.matches("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")) {
        return Double.valueOf(raw);
      }
    } catch (NumberFormatException ignored) {
      // Not a number; keep the original text.
    }
    return raw;
  }

  /** Join content lines, dropping leading and trailing newlines but preserving spaces. */
  private static String joinAndTrim(List<String> lines) {
    String joined = String.join("\n", lines);
    int start = 0;
    int end = joined.length();
    while (start < end && joined.charAt(start) == '\n') {
      start++;
    }
    while (end > start && joined.charAt(end - 1) == '\n') {
      end--;
    }
    return joined.substring(start, end);
  }
}
