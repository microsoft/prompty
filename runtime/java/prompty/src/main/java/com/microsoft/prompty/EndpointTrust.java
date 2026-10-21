package com.microsoft.prompty;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Endpoint trust — keeps ambient credentials on host-approved destinations (spec §2.5.1).
 *
 * <p>A {@code .prompty} file is untrusted input. When its connection carries no file-supplied
 * credential, executors fall back to ambient credentials ({@code DefaultAzureCredential},
 * {@code *_API_KEY} environment variables). This class decides whether the file-chosen destination
 * may receive them.
 *
 * <p>Trusted origins are the union of {@link #BUILTIN_TRUSTED_ENDPOINTS}, the host's
 * {@link LoadOptions#trustedEndpoints()}, and the comma-separated {@value #TRUSTED_ENDPOINTS_ENV}
 * variable (read through {@link Environment}). Frontmatter can never contribute to that set.
 */
public final class EndpointTrust {

  /** Environment variable listing additional trusted origins, comma-separated. */
  public static final String TRUSTED_ENDPOINTS_ENV = "PROMPTY_TRUSTED_ENDPOINTS";

  /** First-party provider origins trusted without host configuration. */
  public static final List<String> BUILTIN_TRUSTED_ENDPOINTS =
      List.of(
          "https://api.openai.com",
          "https://api.anthropic.com",
          "https://*.openai.azure.com",
          "https://*.services.ai.azure.com",
          "https://*.cognitiveservices.azure.com",
          "https://login.microsoftonline.com");

  private static final Map<String, String> CREDENTIAL_KEYS =
      Map.of("key", "apiKey");
  private static final List<String> DESTINATION_KEYS = List.of("endpoint", "tokenUrl");

  private EndpointTrust() {}

  /** An origin: lowercased scheme and host plus an explicit (or default) port. */
  record Origin(String scheme, String host, int port) {}

  /**
   * Parse {@code url} into its origin, or {@code null} when it is not an absolute http(s) URL.
   *
   * <p>Hand-rolled rather than built on {@link java.net.URI}, which rejects hosts the other runtimes
   * accept (underscores, for instance) and would make the same file trusted in one runtime and not
   * another. The rules follow the reference runtime's {@code urlsplit}-based parsing.
   */
  static Origin origin(String url) {
    // HTTP clients treat '\' as '/', so parsers disagree on the host; reject outright.
    if (url.indexOf('\\') >= 0) {
      return null;
    }
    String s = url.strip().replace("\t", "").replace("\r", "").replace("\n", "");
    int colon = s.indexOf(':');
    if (colon <= 0 || !isScheme(s.substring(0, colon))) {
      return null;
    }
    String scheme = s.substring(0, colon).toLowerCase(Locale.ROOT);
    int defaultPort;
    if ("http".equals(scheme)) {
      defaultPort = 80;
    } else if ("https".equals(scheme)) {
      defaultPort = 443;
    } else {
      return null;
    }
    String rest = s.substring(colon + 1);
    if (!rest.startsWith("//")) {
      return null;
    }
    rest = rest.substring(2);
    int end = rest.length();
    for (char delimiter : new char[] {'/', '?', '#'}) {
      int index = rest.indexOf(delimiter);
      if (index >= 0 && index < end) {
        end = index;
      }
    }
    String netloc = rest.substring(0, end);
    boolean open = netloc.indexOf('[') >= 0;
    boolean close = netloc.indexOf(']') >= 0;
    if (open != close) {
      return null;
    }

    String hostinfo = netloc.substring(netloc.lastIndexOf('@') + 1);
    String host;
    String port;
    int bracket = hostinfo.indexOf('[');
    if (bracket >= 0) {
      String bracketed = hostinfo.substring(bracket + 1);
      int closing = bracketed.indexOf(']');
      host = closing < 0 ? bracketed : bracketed.substring(0, closing);
      String after = closing < 0 ? "" : bracketed.substring(closing + 1);
      int portColon = after.indexOf(':');
      port = portColon < 0 ? "" : after.substring(portColon + 1);
    } else {
      int portColon = hostinfo.indexOf(':');
      host = portColon < 0 ? hostinfo : hostinfo.substring(0, portColon);
      port = portColon < 0 ? "" : hostinfo.substring(portColon + 1);
    }
    host = host.toLowerCase(Locale.ROOT);
    if (host.isEmpty()) {
      return null;
    }
    if (port.isEmpty()) {
      return new Origin(scheme, host, defaultPort);
    }
    for (int i = 0; i < port.length(); i++) {
      char c = port.charAt(i);
      if (c < '0' || c > '9') {
        return null;
      }
    }
    int number;
    try {
      number = Integer.parseInt(port);
    } catch (NumberFormatException e) {
      return null;
    }
    if (number > 65535) {
      return null;
    }
    return new Origin(scheme, host, number);
  }

  private static boolean isScheme(String candidate) {
    if (!Character.isLetter(candidate.charAt(0)) || candidate.charAt(0) > 127) {
      return false;
    }
    for (int i = 0; i < candidate.length(); i++) {
      char c = candidate.charAt(i);
      boolean ok =
          (c >= 'a' && c <= 'z')
              || (c >= 'A' && c <= 'Z')
              || (c >= '0' && c <= '9')
              || c == '+'
              || c == '-'
              || c == '.';
      if (!ok) {
        return false;
      }
    }
    return true;
  }

  private static List<String> trustedEntries(List<String> trustedEndpoints) {
    List<String> raw = new ArrayList<>(BUILTIN_TRUSTED_ENDPOINTS);
    if (trustedEndpoints != null) {
      raw.addAll(trustedEndpoints);
    }
    for (String part : Environment.lookup(TRUSTED_ENDPOINTS_ENV).orElse("").split(",", -1)) {
      raw.add(part);
    }
    List<String> entries = new ArrayList<>();
    for (String entry : raw) {
      if (entry != null && !entry.strip().isEmpty()) {
        entries.add(entry.strip());
      }
    }
    return entries;
  }

  /** Whether {@code url}'s origin matches a built-in, host, or environment trusted origin. */
  public static boolean isTrustedEndpoint(String url) {
    return isTrustedEndpoint(url, List.of());
  }

  /**
   * Whether {@code url}'s origin matches a built-in origin, one of {@code trustedEndpoints}, or an
   * entry of {@value #TRUSTED_ENDPOINTS_ENV}.
   */
  public static boolean isTrustedEndpoint(String url, List<String> trustedEndpoints) {
    List<String> entries = trustedEntries(trustedEndpoints);
    if (entries.contains("*")) {
      return true;
    }
    Origin target = url == null ? null : origin(url);
    if (target == null) {
      return false;
    }
    for (String entry : entries) {
      Origin allowed = origin(entry);
      if (allowed == null
          || !allowed.scheme().equals(target.scheme())
          || allowed.port() != target.port()) {
        continue;
      }
      String pattern = allowed.host();
      if (pattern.startsWith("*.")) {
        if (target.host().endsWith(pattern.substring(1))) {
          return true;
        }
      } else if (pattern.equals(target.host())) {
        return true;
      }
    }
    return false;
  }

  static boolean isReference(String value) {
    return value.startsWith("${") && value.endsWith("}");
  }

  private static boolean fileSuppliedCredential(Map<?, ?> connection) {
    // Only the credential field the declared kind actually consumes counts; any other kind is
    // ambient.
    String key = connection.get("kind") instanceof String kind ? CREDENTIAL_KEYS.get(kind) : null;
    if (key == null) {
      return false;
    }
    // Blank keys count as absent: executors that trim fall back to ambient credentials.
    return connection.get(key) instanceof String value && !value.isBlank() && !isReference(value);
  }

  /** The effective destination if the file chose it, or {@code null} when the host did. */
  private static String fileControlledDestination(Object value) {
    if (value == null) {
      return null;
    }
    if (!(value instanceof String s)) {
      return String.valueOf(value);
    }
    if (isReference(s)) {
      String inner = s.substring(2, s.length() - 1);
      int colon = inner.indexOf(':');
      String protocol = colon < 0 ? inner : inner.substring(0, colon);
      if ("env".equals(protocol.toLowerCase(Locale.ROOT))) {
        String rest = colon < 0 ? "" : inner.substring(colon + 1);
        int defaultColon = rest.indexOf(':');
        String varName = defaultColon < 0 ? rest : rest.substring(0, defaultColon);
        String defaultValue = defaultColon < 0 ? "" : rest.substring(defaultColon + 1);
        Optional<String> actual = Environment.lookup(varName);
        if (actual.isPresent()) {
          return null;
        }
        return defaultValue.isEmpty() ? null : defaultValue;
      }
    }
    return s;
  }

  /**
   * Throw {@link LoadException.Kind#UNTRUSTED_ENDPOINT} if ambient credentials could reach a
   * file-chosen, untrusted destination.
   *
   * @param connection the RAW (unresolved) {@code model.connection} value
   * @param trustedEndpoints host-provided trusted origins; may be {@code null}
   */
  public static void checkConnectionTrust(Object connection, List<String> trustedEndpoints) {
    if (!(connection instanceof Map<?, ?> map) || "reference".equals(map.get("kind"))) {
      return;
    }
    if (fileSuppliedCredential(map)) {
      return;
    }
    for (String key : DESTINATION_KEYS) {
      String destination = fileControlledDestination(map.get(key));
      if (destination != null && !isTrustedEndpoint(destination, trustedEndpoints)) {
        throw LoadException.untrustedEndpoint(
            "Connection "
                + key
                + " '"
                + destination
                + "' is not trusted to receive ambient credentials. Set the "
                + key
                + " via ${env:VAR}, add its origin to trustedEndpoints or "
                + TRUSTED_ENDPOINTS_ENV
                + ", or use 'kind: reference'.");
      }
    }
  }
}
