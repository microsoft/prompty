// Named sample constants for connection/connection.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const ConnectionKindSample = #{ kind: "reference" };

const ConnectionAuthenticationModeSample = #{ authenticationMode: "system" };

const ConnectionUsageDescriptionSample = #{
  usageDescription: "This will allow the agent to respond to an email on your behalf",
};

const ReferenceConnectionKindSample = #{ kind: "reference" };

const ReferenceConnectionNameSample = #{ name: "my-reference-connection" };

const ReferenceConnectionTargetSample = #{ target: "my-target-resource" };

const RemoteConnectionKindSample = #{ kind: "remote" };

const RemoteConnectionNameSample = #{ name: "my-reference-connection" };

const RemoteConnectionEndpointSample = #{
  endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
};

const ApiKeyConnectionKindSample = #{ kind: "key" };

const ApiKeyConnectionEndpointSample = #{
  endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
};

const ApiKeyConnectionApiKeySample = #{ apiKey: "your-api-key" };

const AnonymousConnectionKindSample = #{ kind: "anonymous" };

const AnonymousConnectionEndpointSample = #{
  endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
};
