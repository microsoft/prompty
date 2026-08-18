package com.microsoft.prompty;

import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Agent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assumptions;

/**
 * Shared setup for the live provider suites, which call real endpoints instead of fixtures.
 *
 * <p>Credentials come from a {@code .env} beside the Gradle build rather than from the process
 * environment, so a developer can run the live suites without exporting keys into every shell. The
 * file is deliberately untracked; nothing here writes it, and nothing here logs a value.
 *
 * <p>Every live test asks {@link #require} for the variables it needs, so a machine holding only
 * some providers' credentials skips the rest rather than failing. That keeps a partial credential
 * set an honest "not exercised" instead of a red build that says nothing about the code.
 */
public final class LiveEnv {

  private static boolean loaded;

  private LiveEnv() {}

  /**
   * Load {@code runtime/java/.env} into the runtime's environment overlay, once per JVM.
   *
   * <p>Real process variables win, matching the Rust suite, so CI can inject credentials without
   * anyone having to delete a local file first.
   */
  public static synchronized void load() {
    if (loaded) {
      return;
    }
    loaded = true;
    Registry.bootstrap();
    for (Path candidate : candidates()) {
      if (!Files.isRegularFile(candidate)) {
        continue;
      }
      List<String> lines;
      try {
        lines = Files.readAllLines(candidate, StandardCharsets.UTF_8);
      } catch (IOException e) {
        continue;
      }
      for (String raw : lines) {
        String line = raw.trim();
        if (line.isEmpty() || line.startsWith("#")) {
          continue;
        }
        int eq = line.indexOf('=');
        if (eq <= 0) {
          continue;
        }
        String key = line.substring(0, eq).trim();
        String value = stripQuotes(line.substring(eq + 1).trim());
        if (key.isEmpty() || Environment.lookup(key).isPresent()) {
          continue;
        }
        Environment.set(key, value);
      }
      return;
    }
  }

  /**
   * Candidate {@code .env} locations, nearest first: the module, the Gradle root, the repository
   * root.
   *
   * <p>Tests run with the module directory as the working directory, so the Gradle root — which is
   * where the file actually lives — is one level up.
   */
  private static List<Path> candidates() {
    Path module = Path.of("").toAbsolutePath();
    Path gradleRoot = module.getParent() == null ? module : module.getParent();
    Path repoRoot = module.resolve("../../..").normalize();
    return List.of(module.resolve(".env"), gradleRoot.resolve(".env"), repoRoot.resolve(".env"));
  }

  private static String stripQuotes(String value) {
    if (value.length() >= 2
        && ((value.startsWith("\"") && value.endsWith("\""))
            || (value.startsWith("'") && value.endsWith("'")))) {
      return value.substring(1, value.length() - 1);
    }
    return value;
  }

  /**
   * Skip the calling test unless every named variable is set to a non-blank value.
   *
   * <p>Reports the missing name so a skipped run says which credential was absent rather than
   * leaving someone to guess.
   */
  public static void require(String... names) {
    load();
    for (String name : names) {
      String value = Environment.lookup(name).orElse("");
      Assumptions.assumeTrue(!value.isBlank(), () -> "live test skipped: " + name + " is not set");
    }
  }

  /** Read a variable, falling back when it is absent or blank. */
  public static String get(String name, String fallback) {
    load();
    String value = Environment.lookup(name).orElse("");
    return value.isBlank() ? fallback : value;
  }

  /**
   * Build a prompt aimed at a live endpoint.
   *
   * <p>The live suites vary only by provider, model and a handful of knobs, so they share one
   * builder; a suite that assembled its own prompt could pass while disagreeing with the others
   * about what was being asked.
   */
  public static Agent agent(Spec spec) {
    Map<String, Object> connection = new LinkedHashMap<>();
    connection.put("kind", spec.connectionKind);

    Map<String, Object> model = new LinkedHashMap<>();
    model.put("id", spec.modelId);
    model.put("provider", spec.provider);
    model.put("apiType", spec.apiType);
    model.put("connection", connection);
    if (!spec.options.isEmpty()) {
      model.put("options", spec.options);
    }

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "live-" + spec.apiType);
    data.put("kind", "prompt");
    data.put("model", model);
    data.put("instructions", spec.instructions);
    if (!spec.tools.isEmpty()) {
      data.put("tools", spec.tools);
    }
    if (!spec.outputs.isEmpty()) {
      data.put("outputs", spec.outputs);
    }
    return Agent.load(data, new LoadContext());
  }

  /** Mutable description of a live prompt. */
  public static final class Spec {
    private final String provider;
    private String modelId;
    private String apiType = "chat";
    private String connectionKind = "key";
    private String instructions = "";
    private Map<String, Object> options = new LinkedHashMap<>();
    private List<Object> tools = List.of();
    private List<Object> outputs = List.of();

    public Spec(String provider, String modelId) {
      this.provider = provider;
      this.modelId = modelId;
    }

    public Spec modelId(String value) {
      this.modelId = value;
      return this;
    }

    public Spec apiType(String value) {
      this.apiType = value;
      return this;
    }

    public Spec connectionKind(String value) {
      this.connectionKind = value;
      return this;
    }

    public Spec instructions(String value) {
      this.instructions = value;
      return this;
    }

    public Spec chat(String system, String user) {
      this.instructions = "system:\n" + system + "\nuser:\n" + user;
      return this;
    }

    public Spec options(Map<String, Object> value) {
      this.options = new LinkedHashMap<>(value);
      return this;
    }

    public Spec tools(List<Object> value) {
      this.tools = value;
      return this;
    }

    public Spec outputs(List<Object> value) {
      this.outputs = value;
      return this;
    }
  }
}
