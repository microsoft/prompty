import "@typra/emitter";

using Prompty.Conformance.Samples;
namespace Prompty.Contracts.Models;

/** A cloud subscription or account boundary available to the authenticated user. */
model SubscriptionInfo {
  @doc("Stable provider subscription identifier")
  subscriptionId: string;

  @doc("Human-readable subscription name")
  displayName: string;

  @doc("Provider-reported lifecycle state")
  state: string;
}

/** An AI service resource that can host models or projects. */
model AiResourceInfo {
  @doc("Provider resource name")
  name: string;

  @doc("Provider resource kind")
  kind: string;

  @doc("Inference endpoint")
  endpoint: string;

  @doc("Provider region or location")
  location: string;

  @doc("Provider resource group or equivalent administrative grouping")
  resourceGroup: string;

  @doc("Optional service root used to enumerate projects")
  @sample(AiResourceInfoServiceUrlSample)
  serviceUrl?: string;
}

/** A project hosted by an AI service resource. */
model ProjectInfo {
  @doc("Provider project name")
  name: string;

  @doc("Human-readable project name")
  displayName: string;

  @doc("Project-scoped inference endpoint")
  endpoint: string;
}
