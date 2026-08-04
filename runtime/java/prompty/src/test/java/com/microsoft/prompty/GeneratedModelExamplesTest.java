package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.microsoft.prompty.model.GeneratedModelExamples;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Executes every example suite emitted alongside the Typra-generated model.
 *
 * <p>The generated suites are plain {@code run()} entry points rather than JUnit
 * methods, so the generation pipeline emits {@link GeneratedModelExamples} as a
 * deterministic registry and this factory turns each entry into its own test.
 */
final class GeneratedModelExamplesTest {

  @TestFactory
  List<DynamicTest> generatedExamples() {
    Map<String, Runnable> cases = GeneratedModelExamples.all();
    assertFalse(cases.isEmpty(), "No generated model examples were registered");

    List<DynamicTest> tests = new ArrayList<>(cases.size());
    for (Map.Entry<String, Runnable> entry : cases.entrySet()) {
      tests.add(dynamicTest(entry.getKey(), entry.getValue()::run));
    }
    return tests;
  }
}
