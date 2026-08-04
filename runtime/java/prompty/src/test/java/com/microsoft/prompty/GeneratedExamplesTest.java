package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Runs every example the Typra emitter generates for the model layer.
 *
 * <p>The emitter emits one {@code <Type>GeneratedTest} class per model type, each exposing a
 * package-private {@code run()}, plus a {@code TypraGeneratedTests} class that calls them from a
 * {@code main()}. JUnit does not discover either shape, so this factory turns each generated class
 * into its own dynamic test — a failure then names the offending model type instead of collapsing
 * the whole set into one red test.
 *
 * <p>The classes are discovered from the compiled output directory rather than from a generated
 * registry, so nothing outside the emitter's own output has to be kept in sync when the schema
 * gains or loses a type.
 */
final class GeneratedExamplesTest {

  /** The emitter currently produces ~147 example classes; guard against silent discovery of none. */
  private static final int MINIMUM_EXPECTED = 100;

  private static final String RUNNER = "com.microsoft.prompty.model.TypraGeneratedTests";

  @TestFactory
  Stream<DynamicTest> generatedModelExamples() throws Exception {
    List<String> classNames = discover();
    assertTrue(
        classNames.size() >= MINIMUM_EXPECTED,
        "discovered only "
            + classNames.size()
            + " generated example classes, expected at least "
            + MINIMUM_EXPECTED
            + "; the emitter output layout changed");

    return classNames.stream()
        .map(
            className ->
                dynamicTest(
                    className.substring(className.lastIndexOf('.') + 1), () -> invokeRun(className)));
  }

  private static List<String> discover() throws Exception {
    Path packageDir =
        Paths.get(
                Class.forName(RUNNER)
                    .getProtectionDomain()
                    .getCodeSource()
                    .getLocation()
                    .toURI())
            .resolve("com/microsoft/prompty/model");

    List<String> names = new ArrayList<>();
    try (Stream<Path> entries = Files.list(packageDir)) {
      for (Path entry : entries.toList()) {
        String file = entry.getFileName().toString();
        // Nested classes carry a '$'; only the top-level example classes expose run().
        if (file.endsWith("GeneratedTest.class") && !file.contains("$")) {
          names.add("com.microsoft.prompty.model." + file.substring(0, file.length() - ".class".length()));
        }
      }
    }
    Collections.sort(names);
    return names;
  }

  private static void invokeRun(String className) throws Exception {
    Method run = Class.forName(className).getDeclaredMethod("run");
    run.setAccessible(true);
    try {
      run.invoke(null);
    } catch (InvocationTargetException e) {
      // Surface the generated assertion failure itself, not the reflection wrapper.
      Throwable cause = e.getCause();
      if (cause instanceof Error error) {
        throw error;
      }
      if (cause instanceof Exception exception) {
        throw exception;
      }
      throw e;
    }
  }
}
