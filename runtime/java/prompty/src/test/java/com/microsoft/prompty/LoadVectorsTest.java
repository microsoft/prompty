package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.Property;
import com.microsoft.prompty.model.SaveContext;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

/**
 * Runs the shared {@code spec/vectors/load} suite against the Java loader.
 *
 * <p>These are the same cases every other Prompty runtime is held to. Passing them is what makes a
 * {@code .prompty} file portable: the same file, the same environment, the same resulting agent, no
 * matter which language reads it.
 */
class LoadVectorsTest {

  /** Finds the names a vector reads through {@code ${env:NAME}} or {@code ${env:NAME:default}}. */
  private static final Pattern ENV_REFERENCE = Pattern.compile("\\$\\{env:([A-Za-z_][A-Za-z0-9_]*)");

  @TestFactory
  List<DynamicTest> loadVectors() {
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> testCase : SpecVectors.readArray("load/load_vectors.json")) {
      String name = SpecVectors.string(testCase, "name");
      tests.add(dynamicTest(name, () -> runCase(name, testCase)));
    }
    return tests;
  }

  private void runCase(String name, Map<String, Object> testCase) {
    Map<String, Object> input = SpecVectors.map(testCase, "input");
    Map<String, Object> env = SpecVectors.map(input, "env");

    List<String> applied = setEnv(input, env);
    try {
      if (testCase.containsKey("expectedError")) {
        runExpectedErrorCase(name, input, SpecVectors.map(testCase, "expectedError"));
      } else {
        Map<String, Object> expected = SpecVectors.map(testCase, "expected");
        if (expected.containsKey("validated_inputs")) {
          runValidationCase(name, input, expected);
        } else {
          runFieldCase(name, input, expected);
        }
      }
    } finally {
      clearEnv(applied);
    }
  }

  // ---------------------------------------------------------------- case kinds

  private void runFieldCase(String name, Map<String, Object> input, Map<String, Object> expected) {
    Agent agent = load(input);
    // Ask for the long form: named collections as arrays and no shorthand collapsing, which is the
    // shape the shared vectors describe. Both forms round-trip to the same agent; the vectors just
    // pick the one that is unambiguous to write down.
    SaveContext saveContext = new SaveContext("array", false);
    Map<String, Object> actual = agent.save(saveContext);

    for (Map.Entry<String, Object> entry : expected.entrySet()) {
      String key = entry.getKey();
      Object want = entry.getValue();

      if ("kind".equals(key)) {
        // `kind` is consumed while loading — it selects the model type rather than becoming a
        // field. A successful load of a vector that asks for "prompt" is the assertion.
        assertEquals("prompt", want, "[" + name + "] vectors should only load prompt agents");
        continue;
      }
      if ("instructions".equals(key)) {
        assertEquals(want, agent.instructions, "[" + name + "] instructions");
        continue;
      }
      Object got = actual.get(key);
      SpecVectors.assertMatches("[" + name + "] " + key, want, got);
    }
  }

  /**
   * A native {@code expectedError} vector: the load (or its input validation) must fail, and the
   * failure's canonical {@code {kind, [field]}} is derived from the exception TYPE — never from its
   * message text — so a match is on meaning, not coincidental wording.
   */
  private void runExpectedErrorCase(
      String name, Map<String, Object> input, Map<String, Object> expectedError) {
    Map<String, Object> provided = SpecVectors.map(input, "inputs");
    Throwable thrown = null;
    Agent agent = null;
    try {
      agent = load(input);
      Pipeline.validateInputs(agent, provided);
    } catch (RuntimeException e) {
      thrown = e;
    }
    if (thrown == null) {
      fail("[" + name + "] expected an error, but the load succeeded");
    }
    Map<String, Object> observed = canonicalError(thrown, agent, provided);
    SpecVectors.assertMatches("[" + name + "]", expectedError, observed);
  }

  private void runValidationCase(String name, Map<String, Object> input, Map<String, Object> expected) {
    Agent agent = load(input);
    Map<String, Object> validated = Pipeline.validateInputs(agent, SpecVectors.map(input, "inputs"));
    SpecVectors.assertMatches("[" + name + "] validated_inputs", expected.get("validated_inputs"), validated);

    // The vector lists the whole expected result, so anything extra is a defect: an example value
    // leaking through as a default would silently change what the model is asked.
    Object want = expected.get("validated_inputs");
    if (want instanceof Map<?, ?> wantMap) {
      assertEquals(wantMap.size(), validated.size(), "[" + name + "] unexpected extra validated inputs: " + validated);
    }
  }

  /** Map a thrown load/validation failure onto its canonical {@code {kind, [field]}} by TYPE. */
  private static Map<String, Object> canonicalError(Throwable thrown, Agent agent, Map<String, Object> provided) {
    Map<String, Object> payload = new LinkedHashMap<>();
    if (thrown instanceof LoadException load) {
      payload.put("kind", switch (load.kind()) {
        case FILE_NOT_FOUND -> "file_not_found";
        case INVALID_FRONTMATTER -> "invalid_frontmatter";
        case ENV_VAR_NOT_SET -> "env_var_not_set";
        case FILE_REFERENCE -> "file_reference";
        case INVALID_TEMPLATE -> "invalid_template";
        case OTHER -> "other";
      });
    } else if (thrown instanceof InvokerException invoker
        && invoker.kind() == InvokerException.Kind.VALIDATION) {
      payload.put("kind", "missing_required_input");
      String field = firstMissingRequired(agent, provided);
      if (field != null) {
        payload.put("field", field);
      }
    } else {
      payload.put("kind", "other");
    }
    return payload;
  }

  /**
   * Name the first required input that {@link Pipeline#validateInputs} would reject — mirroring its
   * predicate (declared, no value supplied, no default) rather than parsing the error message.
   */
  private static String firstMissingRequired(Agent agent, Map<String, Object> provided) {
    if (agent == null || agent.inputs == null) {
      return null;
    }
    for (Property property : agent.inputs) {
      if (property == null || property.name == null || property.name.isBlank()) {
        continue;
      }
      if (provided != null && provided.containsKey(property.name)) {
        continue;
      }
      if (property.defaultValue == null && Boolean.TRUE.equals(property.required)) {
        return property.name;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- loading

  private Agent load(Map<String, Object> input) {
    String fixture = SpecVectors.string(input, "fixture");
    if (fixture != null) {
      return Loader.load(SpecVectors.fixtures().resolve(fixture));
    }

    String raw = SpecVectors.string(input, "frontmatter_raw");
    Map<String, Object> files = SpecVectors.map(input, "files");
    Path root = tempRoot();

    // A vector may place the agent in a subdirectory so that a `..` file reference escapes the
    // agent's own directory into the surrounding temp root -- the shape the path-traversal
    // containment vectors rely on. Files are written relative to the agent's directory.
    String subdir = SpecVectors.string(input, "agent_subdir");
    Path agentDir = subdir != null ? root.resolve(subdir) : root;
    if (subdir != null) {
      try {
        Files.createDirectories(agentDir);
      } catch (IOException e) {
        throw new UncheckedIOException(e);
      }
    }

    if (raw == null) {
      Object frontmatter = input.get("frontmatter");
      raw = "---\n" + toYaml(frontmatter) + "---\n";
    }

    for (Map.Entry<String, Object> file : files.entrySet()) {
      Path target = agentDir.resolve(file.getKey());
      Object content = file.getValue();
      write(target, content instanceof String text ? text : com.microsoft.prompty.model.TypraJson.stringify(content));
    }

    // `${file:}` references resolve relative to the agent's own directory, so the vector's virtual
    // files have to sit beside a virtual agent path rather than beside the test's working directory.
    return Loader.loadFromString(raw, agentDir.resolve("virtual.prompty"));
  }

  private static String toYaml(Object frontmatter) {
    if (frontmatter == null) {
      return "";
    }
    DumperOptions options = new DumperOptions();
    options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
    return new Yaml(options).dump(frontmatter);
  }

  private Path tempRoot() {
    try {
      Path dir = Files.createTempDirectory("prompty-load-vectors");
      dir.toFile().deleteOnExit();
      return dir;
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static void write(Path target, String content) {
    try {
      Path parent = target.getParent();
      if (parent != null) {
        Files.createDirectories(parent);
      }
      Files.writeString(target, content, StandardCharsets.UTF_8);
      target.toFile().deleteOnExit();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  // ---------------------------------------------------------------- environment

  private static List<String> setEnv(Map<String, Object> input, Map<String, Object> env) {
    List<String> keys = new ArrayList<>();
    for (Map.Entry<String, Object> entry : env.entrySet()) {
      Environment.set(entry.getKey(), String.valueOf(entry.getValue()));
      keys.add(entry.getKey());
    }

    // A vector that references a variable it does not supply -- `${env:NONEXISTENT}` -- is asserting
    // that the variable is unset. Say so explicitly: a JVM cannot remove a name from its own
    // environment, so without a mask the assertion would quietly evaporate on any machine that
    // happens to export it.
    Matcher references = ENV_REFERENCE.matcher(String.valueOf(input));
    while (references.find()) {
      String name = references.group(1);
      if (!env.containsKey(name)) {
        Environment.mask(name);
        keys.add(name);
      }
    }
    return keys;
  }

  private static void clearEnv(List<String> keys) {
    for (String key : keys) {
      Environment.clear(key);
    }
  }

  /** Guards against a silent regression where every vector is skipped. */
  @org.junit.jupiter.api.Test
  void suiteIsNotEmpty() {
    List<Map<String, Object>> cases = SpecVectors.readArray("load/load_vectors.json");
    assertTrue(cases.size() >= 25, "expected the full load vector suite, got " + cases.size());
  }
}
