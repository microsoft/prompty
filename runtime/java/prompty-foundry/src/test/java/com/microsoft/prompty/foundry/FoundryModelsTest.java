package com.microsoft.prompty.foundry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.microsoft.prompty.model.ModelInfo;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Covers the payload edges the shared discovery vectors leave alone.
 *
 * <p>The vectors describe well-formed answers from both Foundry endpoints. Real deployments
 * occasionally omit a field or send it empty, and the reference runtime draws distinctions there
 * that are easy to lose in translation, so those distinctions are pinned here.
 */
class FoundryModelsTest {

  private static Map<String, Object> deployment(Map<String, Object> extra) {
    Map<String, Object> raw = new LinkedHashMap<>();
    raw.put("name", "my-deployment");
    raw.putAll(extra);
    return raw;
  }

  @Nested
  @DisplayName("publisher attribution")
  class Publisher {

    @Test
    @DisplayName("a deployment that names no publisher is still attributed to Azure")
    void absentPublisherFallsBack() {
      ModelInfo info = FoundryModels.deploymentToModelInfo(deployment(Map.of()));
      assertEquals("azure", info.ownedBy);
    }

    @Test
    @DisplayName("a publisher the endpoint sent as empty is kept, not replaced")
    void emptyPublisherIsKept() {
      ModelInfo info =
          FoundryModels.deploymentToModelInfo(deployment(Map.of("modelPublisher", "")));
      assertEquals("", info.ownedBy);
    }

    @Test
    @DisplayName("a nested publisher is found when the flat one is absent")
    void nestedPublisherIsUsed() {
      Map<String, Object> raw =
          deployment(Map.of("properties", Map.of("model", Map.of("publisher", "contoso"))));
      assertEquals("contoso", FoundryModels.deploymentToModelInfo(raw).ownedBy);
    }
  }

  @Nested
  @DisplayName("identity")
  class Identity {

    @Test
    @DisplayName("a deployment with no name still round trips with an id")
    void missingNameBecomesEmptyId() {
      ModelInfo info = FoundryModels.deploymentToModelInfo(Map.of("modelName", "gpt-4o"));
      assertEquals("", info.id);
    }

    @Test
    @DisplayName("a catalog entry with no id still round trips with an id")
    void missingCatalogIdBecomesEmpty() {
      ModelInfo info = FoundryModels.catalogModelToModelInfo(Map.of("owned_by", ""));
      assertEquals("", info.id);
    }

    @Test
    @DisplayName("a payload that is not an object yields a blank record rather than throwing")
    void nonObjectIsTolerated() {
      assertEquals("", FoundryModels.deploymentToModelInfo("not-an-object").id);
      assertNull(FoundryModels.deploymentToModelInfo(null).contextWindow);
      assertEquals("", FoundryModels.catalogModelToModelInfo(List.of()).id);
    }
  }

  @Nested
  @DisplayName("capability blocks")
  class CapabilityBlocks {

    @Test
    @DisplayName("a capability block the endpoint sent empty is honoured, not skipped")
    void presentButEmptyBlockWins() {
      Map<String, Object> raw =
          deployment(
              Map.of(
                  "properties", Map.of("capabilities", Map.of()),
                  "capabilities", Map.of("inputModalities", List.of("text", "image"))));
      ModelInfo info = FoundryModels.deploymentToModelInfo(raw);
      assertNull(info.inputModalities, "the sibling block must not stand in for an empty one");
    }

    @Test
    @DisplayName("modalities sent as a comma separated string are split")
    void commaSeparatedModalities() {
      Map<String, Object> raw =
          deployment(Map.of("capabilities", Map.of("supportedInputModalities", "text, image")));
      assertEquals(List.of("text", "image"), FoundryModels.deploymentToModelInfo(raw).inputModalities);
    }

    @Test
    @DisplayName("a context length sent as a string is still a number")
    void stringEncodedContextLength() {
      Map<String, Object> raw =
          deployment(Map.of("capabilities", Map.of("maxContextLength", "128000")));
      assertEquals(128000, FoundryModels.deploymentToModelInfo(raw).contextWindow);
    }

    @Test
    @DisplayName("a context length that is not a number is dropped rather than fatal")
    void unparseableContextLength() {
      Map<String, Object> raw =
          deployment(Map.of("capabilities", Map.of("maxContextLength", "very large")));
      assertNull(FoundryModels.deploymentToModelInfo(raw).contextWindow);
    }
  }

  @Test
  @DisplayName("the shared dataset carries no Foundry entries, so what the endpoint sent stands")
  void datasetLeavesFoundryAlone() {
    // Deployments name a deployment, not a model family, so prefix matching against a model table
    // would be guesswork. The dataset therefore declares no Foundry entries and enrichment is a
    // no-op here — a fact worth pinning, because a future entry would silently start rewriting
    // fields the endpoint already answered for.
    ModelInfo info = FoundryModels.deploymentToModelInfo(Map.of("name", "gpt-4o"));
    assertNull(info.contextWindow);
    assertNull(info.inputModalities);
    assertNull(info.outputModalities);
  }
}
