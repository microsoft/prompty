package com.microsoft.prompty.foundry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.AiResourceInfo;
import com.microsoft.prompty.model.ProjectInfo;
import com.microsoft.prompty.model.SubscriptionInfo;
import com.microsoft.prompty.model.TypraJson;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Covers the ARM discovery mappers: which resources are offerable, which endpoint a caller should
 * use, and how a project's identity is derived from an ARM payload.
 *
 * <p>The paging loop needs a live control plane, so the tests here work on the parsing that turns
 * ARM's payloads into the provider-neutral model — which is where the decisions that can silently
 * produce an unusable picker entry actually live.
 */
@DisplayName("Foundry ARM discovery")
final class FoundryArmTest {

  @Nested
  @DisplayName("subscriptions")
  class Subscriptions {

    @Test
    void anEnabledSubscriptionIsKept() {
      SubscriptionInfo subscription =
          FoundryArm.parseSubscription(
              json("{\"subscriptionId\":\"sub-1\",\"displayName\":\"Prod\",\"state\":\"Enabled\"}"));
      assertNotNull(subscription);
      assertEquals("sub-1", subscription.subscriptionId);
      assertEquals("Prod", subscription.displayName);
      assertEquals("Enabled", subscription.state);
    }

    @Test
    void aDisabledSubscriptionIsDropped() {
      // Offering a disabled subscription would produce a picker entry every later call rejects.
      assertNull(
          FoundryArm.parseSubscription(
              json("{\"subscriptionId\":\"sub-2\",\"displayName\":\"Old\",\"state\":\"Disabled\"}")));
    }

    @Test
    void aSubscriptionWithNoStateIsDropped() {
      assertNull(FoundryArm.parseSubscription(json("{\"subscriptionId\":\"sub-3\"}")));
    }
  }

  @Nested
  @DisplayName("AI resources")
  class AiResources {

    @Test
    void theNamedInferenceEndpointWins() {
      AiResourceInfo resource =
          FoundryArm.parseAiResource(
              json(
                  """
                  {
                    "name": "myaccount",
                    "kind": "AIServices",
                    "location": "eastus",
                    "id": "/subscriptions/s/resourceGroups/my-rg/providers/x/accounts/myaccount",
                    "properties": {
                      "endpoint": "https://generic.example",
                      "endpoints": {
                        "OpenAI Language Model Instance API": "https://preferred.example"
                      }
                    }
                  }
                  """));
      assertNotNull(resource);
      // An AI Services account publishes several endpoints and only this one speaks the OpenAI API.
      assertEquals("https://preferred.example", resource.endpoint);
      assertEquals("my-rg", resource.resourceGroup);
      assertEquals("eastus", resource.location);
      assertEquals("https://myaccount.services.ai.azure.com", resource.serviceUrl);
    }

    @Test
    void theGenericEndpointIsTheFallback() {
      AiResourceInfo resource =
          FoundryArm.parseAiResource(
              json(
                  "{\"name\":\"acct\",\"kind\":\"OpenAI\",\"id\":\"\","
                      + "\"properties\":{\"endpoint\":\"https://generic.example\"}}"));
      assertNotNull(resource);
      assertEquals("https://generic.example", resource.endpoint);
    }

    @Test
    void anEmptyPreferredEndpointFallsThroughRatherThanWinning() {
      // Present-but-empty is the case that would otherwise produce a resource with no endpoint.
      AiResourceInfo resource =
          FoundryArm.parseAiResource(
              json(
                  "{\"name\":\"acct\",\"kind\":\"OpenAI\",\"id\":\"\",\"properties\":{"
                      + "\"endpoint\":\"https://generic.example\","
                      + "\"endpoints\":{\"OpenAI Language Model Instance API\":\"\"}}}"));
      assertNotNull(resource);
      assertEquals("https://generic.example", resource.endpoint);
    }

    @Test
    void aResourceWithNoEndpointAtAllIsDropped() {
      assertNull(
          FoundryArm.parseAiResource(
              json("{\"name\":\"acct\",\"kind\":\"OpenAI\",\"id\":\"\",\"properties\":{}}")));
    }

    @Test
    void anUnrelatedKindIsDropped() {
      // Cognitive Services hosts speech, vision, and more; none of them accept a chat completion.
      assertNull(
          FoundryArm.parseAiResource(
              json(
                  "{\"name\":\"speech\",\"kind\":\"SpeechServices\",\"id\":\"\","
                      + "\"properties\":{\"endpoint\":\"https://speech.example\"}}")));
    }

    @Test
    void onlyAiServicesAccountsGetAProjectStyleHost() {
      AiResourceInfo openAi =
          FoundryArm.parseAiResource(
              json(
                  "{\"name\":\"acct\",\"kind\":\"OpenAI\",\"id\":\"\","
                      + "\"properties\":{\"endpoint\":\"https://e.example\"}}"));
      assertNotNull(openAi);
      // A classic Azure OpenAI account has no services.ai alias, so inventing one would 404.
      assertNull(openAi.serviceUrl);
    }

    @Test
    void theResourceGroupIsReadCaseInsensitively() {
      // ARM writes this segment both ways and they name the same thing.
      assertEquals(
          "my-rg",
          FoundryArm.extractResourceGroup(
              "/subscriptions/s/resourcegroups/my-rg/providers/x/accounts/a"));
      assertEquals(
          "my-rg",
          FoundryArm.extractResourceGroup(
              "/subscriptions/s/resourceGroups/my-rg/providers/x/accounts/a"));
    }

    @Test
    void anIdWithNoResourceGroupYieldsEmpty() {
      assertEquals("", FoundryArm.extractResourceGroup("/subscriptions/s"));
    }

    @Test
    void aTrailingResourceGroupsSegmentWithNoNameYieldsEmpty() {
      // Guards the index-plus-one read against running off the end of the id.
      assertEquals("", FoundryArm.extractResourceGroup("/subscriptions/s/resourceGroups"));
    }
  }

  @Nested
  @DisplayName("projects")
  class Projects {

    @Test
    void anAbsentDisplayNameFallsBackButAnEmptyOneIsKept() {
      // These two cases look alike after the usual "missing or blank" flattening, and they are not
      // alike: only one of them is the author saying something. Rust distinguishes them, so a
      // project rendered from the same ARM payload must read the same in both runtimes.
      ProjectInfo absent =
          FoundryArm.parseModernProject(json("{\"name\":\"acct/proj\",\"properties\":{}}"), "acct");
      assertEquals("proj", absent.displayName);

      ProjectInfo empty =
          FoundryArm.parseModernProject(
              json("{\"name\":\"acct/proj\",\"properties\":{\"displayName\":\"\"}}"), "acct");
      assertEquals("", empty.displayName);
    }

    @Test
    void anAbsentFriendlyNameFallsBackButAnEmptyOneIsKept() {
      ProjectInfo absent =
          FoundryArm.parseClassicWorkspace(
              json("{\"kind\":\"Project\",\"name\":\"ws\",\"properties\":{}}"), "acct");
      assertEquals("ws", absent.displayName);

      ProjectInfo empty =
          FoundryArm.parseClassicWorkspace(
              json("{\"kind\":\"Project\",\"name\":\"ws\",\"properties\":{\"friendlyName\":\"\"}}"),
              "acct");
      assertEquals("", empty.displayName);
    }

    @Test
    void aModernProjectKeepsOnlyTheChildSegmentOfItsName() {      ProjectInfo project =
          FoundryArm.parseModernProject(
              json("{\"name\":\"myaccount/myproject\",\"properties\":{\"displayName\":\"My Project\"}}"),
              "myaccount");
      // ARM names a child resource "parent/child"; a picker showing the pair would be nonsense, and
      // the endpoint built from it would be wrong.
      assertEquals("myproject", project.name);
      assertEquals("My Project", project.displayName);
      assertEquals(
          "https://myaccount.services.ai.azure.com/api/projects/myproject", project.endpoint);
    }

    @Test
    void aModernProjectWithoutADisplayNameFallsBackToItsName() {
      ProjectInfo project =
          FoundryArm.parseModernProject(json("{\"name\":\"acct/proj\"}"), "acct");
      assertEquals("proj", project.displayName);
    }

    @Test
    void anUnqualifiedModernProjectNameIsUsedAsIs() {
      ProjectInfo project = FoundryArm.parseModernProject(json("{\"name\":\"proj\"}"), "acct");
      assertEquals("proj", project.name);
    }

    @Test
    void aClassicWorkspaceOfKindProjectBecomesAProject() {
      ProjectInfo project =
          FoundryArm.parseClassicWorkspace(
              json("{\"name\":\"ws\",\"kind\":\"Project\",\"properties\":{\"friendlyName\":\"Friendly\"}}"),
              "acct");
      assertNotNull(project);
      assertEquals("ws", project.name);
      assertEquals("Friendly", project.displayName);
      assertEquals("https://acct.services.ai.azure.com/api/projects/ws", project.endpoint);
    }

    @Test
    void aClassicWorkspaceOfAnotherKindIsDropped() {
      // The workspaces endpoint also returns hubs and plain ML workspaces, which are not projects.
      assertNull(
          FoundryArm.parseClassicWorkspace(json("{\"name\":\"hub\",\"kind\":\"Hub\"}"), "acct"));
    }

    @Test
    void aClassicWorkspaceWithoutAFriendlyNameFallsBackToItsName() {
      ProjectInfo project =
          FoundryArm.parseClassicWorkspace(json("{\"name\":\"ws\",\"kind\":\"Project\"}"), "acct");
      assertNotNull(project);
      assertEquals("ws", project.displayName);
    }

    @Test
    void bothProjectShapesBuildTheSameEndpointForm() {
      // The two ARM shapes are an implementation detail of how a project was created; a caller must
      // not be able to tell them apart from the endpoint it is handed.
      ProjectInfo modern = FoundryArm.parseModernProject(json("{\"name\":\"acct/p\"}"), "acct");
      ProjectInfo classic =
          FoundryArm.parseClassicWorkspace(json("{\"name\":\"p\",\"kind\":\"Project\"}"), "acct");
      assertNotNull(classic);
      assertEquals(modern.endpoint, classic.endpoint);
    }
  }

  @Nested
  @DisplayName("model shape")
  class ModelShape {

    @Test
    void resultsRoundTripThroughTheGeneratedModel() {
      // These values cross a process boundary as the generated model, so a field the mappers set but
      // the model does not persist would silently vanish on the way to a host.
      AiResourceInfo resource =
          FoundryArm.parseAiResource(
              json(
                  "{\"name\":\"acct\",\"kind\":\"AIServices\",\"location\":\"westus\","
                      + "\"id\":\"/subscriptions/s/resourceGroups/rg/x\","
                      + "\"properties\":{\"endpoint\":\"https://e.example\"}}"));
      assertNotNull(resource);
      Map<String, Object> saved =
          resource.save(new com.microsoft.prompty.model.SaveContext());
      assertEquals("acct", saved.get("name"));
      assertEquals("rg", saved.get("resourceGroup"));
      assertTrue(
          String.valueOf(saved.get("serviceUrl")).contains("services.ai.azure.com"),
          "the project-style host should survive the round trip: " + saved);
    }
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> json(String text) {
    return (Map<String, Object>) TypraJson.parse(text);
  }
}
