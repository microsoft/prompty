package com.microsoft.prompty.foundry;

import com.microsoft.prompty.Http;
import com.microsoft.prompty.model.AiResourceInfo;
import com.microsoft.prompty.model.ProjectInfo;
import com.microsoft.prompty.model.SubscriptionInfo;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
/**
 * Read-only resource enumeration against the Azure Resource Manager control plane.
 *
 * <p>Answers the three questions a Foundry resource picker has to ask in order: which subscriptions
 * can this identity see, which AI resources live in one, and which projects belong to a resource.
 * Every call needs a management-plane bearer token — {@link FoundryOAuth#AZURE_MANAGEMENT_SCOPE},
 * not the inference scope used to call a model.
 *
 * <p>Only the protocol lives here. Selection, ordering, caching, and any interactive wizard are host
 * concerns, and results are returned as the generated provider-neutral model rather than an
 * ARM-shaped one so a host is not coupled to Azure's payload layout.
 */
public final class FoundryArm {

  private static final String ARM_BASE = "https://management.azure.com";

  /**
   * The bound on a single control-plane exchange.
   *
   * <p>A person is usually waiting on a picker while these run, so a stalled response has to fail
   * rather than hang. Model calls get no such bound because a slow answer there is still an answer.
   */
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);
  private static final String SUBSCRIPTIONS_API_VERSION = "2022-12-01";
  private static final String ACCOUNTS_API_VERSION = "2023-05-01";
  private static final String COGNITIVE_PROJECTS_API_VERSION = "2025-04-01-preview";
  private static final String ML_WORKSPACES_API_VERSION = "2024-10-01";

  /**
   * The endpoint entry a model call should prefer.
   *
   * <p>An AI Services account publishes several endpoints; this is the one that speaks the OpenAI
   * inference API, and picking any other would yield a URL that authenticates but cannot complete.
   */
  private static final String ENDPOINT_PREFERENCE_KEY = "OpenAI Language Model Instance API";

  private static final String PROVIDER = "azure-arm";

  private FoundryArm() {}

  /** List the subscriptions this token can see, keeping only those that are enabled. */
  public static List<SubscriptionInfo> listSubscriptions(String token) {
    List<SubscriptionInfo> subscriptions = new ArrayList<>();
    for (Map<String, Object> item :
        fetchAll(token, ARM_BASE + "/subscriptions?api-version=" + SUBSCRIPTIONS_API_VERSION)) {
      SubscriptionInfo subscription = parseSubscription(item);
      if (subscription != null) {
        subscriptions.add(subscription);
      }
    }
    return subscriptions;
  }

  /**
   * List the Azure OpenAI and AI Services accounts in a subscription.
   *
   * <p>Accounts of other kinds, and accounts with no usable inference endpoint, are dropped: a
   * picker entry the caller cannot actually send a request to is worse than no entry at all.
   */
  public static List<AiResourceInfo> listAiResources(String token, String subscriptionId) {
    String url =
        ARM_BASE
            + "/subscriptions/"
            + subscriptionId
            + "/providers/Microsoft.CognitiveServices/accounts?api-version="
            + ACCOUNTS_API_VERSION;
    List<AiResourceInfo> resources = new ArrayList<>();
    for (Map<String, Object> item : fetchAll(token, url)) {
      AiResourceInfo resource = parseAiResource(item);
      if (resource != null) {
        resources.add(resource);
      }
    }
    return resources;
  }

  /**
   * List the Foundry projects belonging to an account.
   *
   * <p>Projects exist in two shapes. New Foundry exposes them as a sub-resource of the account;
   * classic hubs model them as Machine Learning workspaces. The classic endpoint is consulted only
   * when the new one yields nothing, so a modern account is never charged for a second round trip.
   *
   * <p>Each strategy soft-fails to empty. A tenant that denies one of the two providers is common
   * and is not a reason to fail the whole call; an empty list means "none found", which is exactly
   * what a picker should show.
   */
  public static List<ProjectInfo> listFoundryProjects(
      String token, String subscriptionId, String resourceGroup, String resourceName) {
    List<ProjectInfo> projects = new ArrayList<>();

    String modern =
        ARM_BASE
            + "/subscriptions/"
            + subscriptionId
            + "/resourceGroups/"
            + resourceGroup
            + "/providers/Microsoft.CognitiveServices/accounts/"
            + resourceName
            + "/projects?api-version="
            + COGNITIVE_PROJECTS_API_VERSION;
    for (Map<String, Object> item : fetchAllOrEmpty(token, modern)) {
      projects.add(parseModernProject(item, resourceName));
    }

    if (projects.isEmpty()) {
      String classic =
          ARM_BASE
              + "/subscriptions/"
              + subscriptionId
              + "/providers/Microsoft.MachineLearningServices/workspaces?api-version="
              + ML_WORKSPACES_API_VERSION;
      for (Map<String, Object> item : fetchAllOrEmpty(token, classic)) {
        ProjectInfo project = parseClassicWorkspace(item, resourceName);
        if (project != null) {
          projects.add(project);
        }
      }
    }

    return projects;
  }

  // ---------------------------------------------------------------------------------------------
  // Paging
  // ---------------------------------------------------------------------------------------------

  /**
   * Read every page of an ARM list endpoint.
   *
   * <p>ARM returns absolute {@code nextLink} URLs, so each page dictates where the next one is
   * rather than the caller computing offsets.
   */
  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> fetchAll(String token, String firstUrl) {
    List<Map<String, Object>> items = new ArrayList<>();
    String next = firstUrl;

    while (next != null && !next.isEmpty()) {
      Object body =
          Http.getJson(
              PROVIDER, next, Map.of("Authorization", "Bearer " + token), REQUEST_TIMEOUT);
      if (!(body instanceof Map<?, ?> page)) {
        break;
      }
      if (page.get("value") instanceof List<?> values) {
        for (Object value : values) {
          if (value instanceof Map<?, ?> entry) {
            items.add((Map<String, Object>) entry);
          }
        }
      }
      next = page.get("nextLink") instanceof String link ? link : null;
    }

    return items;
  }

  /** {@link #fetchAll} with failure treated as an empty page, for the soft-failing project probes. */
  private static List<Map<String, Object>> fetchAllOrEmpty(String token, String url) {
    try {
      return fetchAll(token, url);
    } catch (RuntimeException e) {
      return List.of();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------------------------

  static SubscriptionInfo parseSubscription(Map<String, Object> item) {
    String state = string(item, "state");
    if (!"Enabled".equals(state)) {
      return null;
    }
    SubscriptionInfo subscription = new SubscriptionInfo();
    subscription.subscriptionId = string(item, "subscriptionId");
    subscription.displayName = string(item, "displayName");
    subscription.state = state;
    return subscription;
  }

  static AiResourceInfo parseAiResource(Map<String, Object> item) {
    String kind = string(item, "kind");
    if (!"AIServices".equals(kind) && !"OpenAI".equals(kind)) {
      return null;
    }

    Map<String, Object> properties = object(item, "properties");
    String endpoint = string(object(properties, "endpoints"), ENDPOINT_PREFERENCE_KEY);
    if (endpoint.isEmpty()) {
      endpoint = string(properties, "endpoint");
    }
    if (endpoint.isEmpty()) {
      // No inference endpoint means nothing can be sent here, so the entry is not offerable.
      return null;
    }

    String name = string(item, "name");
    AiResourceInfo resource = new AiResourceInfo();
    resource.name = name;
    resource.kind = kind;
    resource.endpoint = endpoint;
    resource.location = string(item, "location");
    resource.resourceGroup = extractResourceGroup(string(item, "id"));
    // Only AI Services accounts have the project-style host; an OpenAI account has no such alias.
    resource.serviceUrl =
        "AIServices".equals(kind) ? "https://" + name + ".services.ai.azure.com" : null;
    return resource;
  }

  static ProjectInfo parseModernProject(Map<String, Object> item, String resourceName) {
    // ARM names a child resource "parent/child"; the picker wants the child alone.
    String full = string(item, "name");
    int slash = full.lastIndexOf('/');
    String shortName = slash < 0 ? full : full.substring(slash + 1);

    String displayName = string(object(item, "properties"), "displayName");

    ProjectInfo project = new ProjectInfo();
    project.name = shortName;
    // Absence falls back to the resource name; an explicit empty string is kept. A project the
    // author deliberately left unnamed reads the same in every runtime this way.
    project.displayName = present(object(item, "properties"), "displayName") ? displayName : shortName;
    project.endpoint =
        "https://" + resourceName + ".services.ai.azure.com/api/projects/" + shortName;
    return project;
  }

  static ProjectInfo parseClassicWorkspace(Map<String, Object> item, String resourceName) {
    if (!"Project".equals(string(item, "kind"))) {
      return null;
    }
    String name = string(item, "name");
    String friendly = string(object(item, "properties"), "friendlyName");

    ProjectInfo project = new ProjectInfo();
    project.name = name;
    project.displayName = present(object(item, "properties"), "friendlyName") ? friendly : name;
    project.endpoint = "https://" + resourceName + ".services.ai.azure.com/api/projects/" + name;
    return project;
  }

  /**
   * Pull the resource-group segment out of an ARM resource id.
   *
   * <p>Matched case-insensitively because ARM is inconsistent about whether it writes
   * {@code resourceGroups} or {@code resourcegroups}, and the two refer to the same thing.
   */
  static String extractResourceGroup(String id) {
    String[] segments = id.split("/");
    for (int i = 0; i < segments.length - 1; i++) {
      if (segments[i].equalsIgnoreCase("resourceGroups")) {
        return segments[i + 1];
      }
    }
    return "";
  }

  private static String string(Map<String, Object> source, String key) {
    return source.get(key) instanceof String text ? text : "";
  }

  /**
   * Whether a key carries a string, as distinct from carrying an empty one.
   *
   * <p>{@link #string} flattens "absent", "not a string", and "" to the same value, which is right
   * nearly everywhere. It is wrong where a fallback applies only on absence, because it would then
   * also overwrite a deliberately empty value.
   */
  private static boolean present(Map<String, Object> source, String key) {
    return source.get(key) instanceof String;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> object(Map<String, Object> source, String key) {
    return source.get(key) instanceof Map<?, ?> nested
        ? (Map<String, Object>) nested
        : Map.of();
  }
}
