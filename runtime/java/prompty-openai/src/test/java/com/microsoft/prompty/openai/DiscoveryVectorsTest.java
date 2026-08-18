package com.microsoft.prompty.openai;

import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.model.ModelInfo;
import com.microsoft.prompty.model.SaveContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Grades the OpenAI half of the shared discovery and enrichment suites.
 *
 * <p>The discovery vectors pin the wire mapping; the enrichment vectors pin the shared capability
 * dataset and the fill-only-missing rule that applies it. Both are the same fixtures every other
 * runtime is measured by.
 */
class DiscoveryVectorsTest {

  @TestFactory
  Iterable<DynamicTest> discoveryVectors() {
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> vector : SpecVectors.readCases("discovery/discovery_vectors.json", "vectors")) {
      if (!"openai".equals(vector.get("provider"))) {
        continue;
      }
      String name = SpecVectors.string(vector, "name");
      tests.add(
          DynamicTest.dynamicTest(
              name,
              () -> {
                ModelInfo actual =
                    OpenAIModelLister.modelInfoFromWire(SpecVectors.map(vector, "input"));
                SpecVectors.assertEquivalent(
                    name, vector.get("expected"), actual.save(new SaveContext()));
              }));
    }
    return tests;
  }

  @TestFactory
  Iterable<DynamicTest> enrichmentVectors() {
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> vector : SpecVectors.readCases("discovery/enrichment_vectors.json", "vectors")) {
      if (!"openai".equals(vector.get("provider"))) {
        continue;
      }
      String name = SpecVectors.string(vector, "name");
      tests.add(
          DynamicTest.dynamicTest(
              name,
              () -> {
                ModelInfo info = ModelInfo.load(SpecVectors.map(vector, "input"), null);
                com.microsoft.prompty.Discovery.enrich("openai", info);
                SpecVectors.assertEquivalent(
                    name, vector.get("expected"), info.save(new SaveContext()));
              }));
    }
    return tests;
  }
}
