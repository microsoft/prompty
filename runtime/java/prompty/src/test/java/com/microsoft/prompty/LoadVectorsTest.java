package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.SaveContext;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
    Map<String, Object> expected = SpecVectors.map(testCase, "expected");
    Map<String, Object> env = SpecVectors.map(input, "env");

    List<String> applied = setEnv(env);
    try {
      if (expected.containsKey("error")) {
        runErrorCase(name, input, expected);
      } else if (expected.containsKey("validated_inputs")) {
        runValidationCase(name, input, expected);
      } else {
        runFieldCase(name, input, expected);
      }
    } finally {
      clearEnv(applied);
    }
  }

  // ---------------------------------------------------------------- case kinds

  private void runFieldCase(String name, Map<String, Object> input, Map<String, Object> expected) {
    Prompty agent = load(input);
    // Ask for the long form: named collections as arrays and no shorthand collapsing, which is the
    // shape the shared vectors describe. Both forms round-trip to the same agent; the vectors just
    // pick the one that is unambiguous to write down.
    SaveContext saveContext = new SaveContext();
    saveContext.collectionFormat = "array";
    saveContext.useShorthand = false;
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

  private void runErrorCase(String name, Map<String, Object> input, Map<String, Object> expected) {
    Throwable thrown = null;
    try {
      Prompty agent = load(input);
      Map<String, Object> inputs = SpecVectors.map(input, "inputs");
      Pipeline.validateInputs(agent, inputs);
    } catch (RuntimeException e) {
      thrown = e;
    }

    SpecVectors.assertErrorMatches("[" + name + "]", SpecVectors.string(expected, "error"), thrown);

    String field = SpecVectors.string(expected, "error_field");
    if (field != null) {
      assertTrue(
          thrown.getMessage() != null && thrown.getMessage().contains(field),
          "[" + name + "] error should name the offending field \"" + field + "\": " + thrown.getMessage());
    }
  }

  private void runValidationCase(String name, Map<String, Object> input, Map<String, Object> expected) {
    Prompty agent = load(input);
    Map<String, Object> validated = Pipeline.validateInputs(agent, SpecVectors.map(input, "inputs"));
    SpecVectors.assertMatches("[" + name + "] validated_inputs", expected.get("validated_inputs"), validated);

    // The vector lists the whole expected result, so anything extra is a defect: an example value
    // leaking through as a default would silently change what the model is asked.
    Object want = expected.get("validated_inputs");
    if (want instanceof Map<?, ?> wantMap) {
      assertEquals(wantMap.size(), validated.size(), "[" + name + "] unexpected extra validated inputs: " + validated);
    }
  }

  // ---------------------------------------------------------------- loading

  private Prompty load(Map<String, Object> input) {
    String fixture = SpecVectors.string(input, "fixture");
    if (fixture != null) {
      return Loader.load(SpecVectors.fixtures().resolve(fixture));
    }

    String raw = SpecVectors.string(input, "frontmatter_raw");
    Map<String, Object> files = SpecVectors.map(input, "files");
    Path root = tempRoot();

    if (raw == null) {
      Object frontmatter = input.get("frontmatter");
      raw = "---\n" + toYaml(frontmatter) + "---\n";
    }

    for (Map.Entry<String, Object> file : files.entrySet()) {
      Path target = root.resolve(file.getKey());
      Object content = file.getValue();
      write(target, content instanceof String text ? text : com.microsoft.prompty.model.TypraJson.stringify(content));
    }

    // `${file:}` references resolve relative to the agent's own directory, so the vector's virtual
    // files have to sit beside a virtual agent path rather than beside the test's working directory.
    return Loader.loadFromString(raw, root.resolve("virtual.prompty"));
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

  private static List<String> setEnv(Map<String, Object> env) {
    List<String> keys = new ArrayList<>();
    for (Map.Entry<String, Object> entry : env.entrySet()) {
      Environment.set(entry.getKey(), String.valueOf(entry.getValue()));
      keys.add(entry.getKey());
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
