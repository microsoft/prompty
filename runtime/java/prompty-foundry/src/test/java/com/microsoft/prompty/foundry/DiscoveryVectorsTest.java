package com.microsoft.prompty.foundry;

import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.model.ModelInfo;
import com.microsoft.prompty.model.SaveContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Grades the Foundry half of the shared discovery suite.
 *
 * <p>Foundry answers from two endpoints, so each vector names the shape it carries and is routed to
 * the matching mapper.
 */
class DiscoveryVectorsTest {

  @TestFactory
  Iterable<DynamicTest> discoveryVectors() {
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> vector : SpecVectors.readCases("discovery/discovery_vectors.json", "vectors")) {
      if (!"foundry".equals(vector.get("provider"))) {
        continue;
      }
      String name = SpecVectors.string(vector, "name");
      String shape = SpecVectors.string(vector, "shape");
      tests.add(
          DynamicTest.dynamicTest(
              name,
              () -> {
                Map<String, Object> input = SpecVectors.map(vector, "input");
                ModelInfo actual =
                    switch (shape) {
                      case "deployment" -> FoundryModels.deploymentToModelInfo(input);
                      case "catalog" -> FoundryModels.catalogModelToModelInfo(input);
                      default -> throw new AssertionError("Unknown shape: " + shape);
                    };
                SpecVectors.assertEquivalent(
                    name, vector.get("expected"), actual.save(new SaveContext()));
              }));
    }
    return tests;
  }
}
