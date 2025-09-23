import "./connection.tsp";

namespace Prompty.Core {
  /**
   * Definition for an environment variable used in containerized agents.
   */
  @shorthand(string, #{ value: "{value}" })
  model EnvironmentVariable {
    @doc("Environment variable resolution")
    @sample(#{ value: "my-value" })
    value: string;
  }

  alias EnvironmentVariables = Record<EnvironmentVariable> | Named<
    EnvironmentVariable,
    "Name of the environment variable",
    #{ name: "MY_ENV_VAR" }
  >[];

  /**
   * Definition for a containerized AI agent.
   */
  model ContainerDefinition {
    @doc("The container image name")
    @sample(#{ image: "my-container-image" })
    image: string;

    @doc("The container image tag (defaults to 'latest' if not specified)")
    @sample(#{ tag: "v1.0.0" })
    tag?: string = "latest";

    @doc("Container image registry definition")
    @sample(#{
      registry: #{
        kind: "acr",
        connection: #{
          kind: "key",
          authority: "system",
          usageDescription: "Access to the container registry",
        },
      },
    })
    registry: Registry;

    @doc("Instance scaling configuration")
    @sample(#{
      scale: #{ minReplicas: 1, maxReplicas: 5, cpu: 0.5, memory: 2.0 },
    })
    scale: Scale;
  }

  /**
   * Configuration for scaling container instances.
   */
  model Scale {
    @doc("Minimum number of container instances to run")
    @sample(#{ minReplicas: 1 })
    minReplicas?: int32 = 1;

    @doc("Maximum number of container instances to run")
    @sample(#{ maxReplicas: 5 })
    maxReplicas?: int32 = 5;

    @doc("CPU allocation per instance (in cores)")
    @sample(#{ cpu: 0.5 })
    cpu: float32 = 0.5;

    @doc("Memory allocation per instance (in GB)")
    @sample(#{ memory: 2.0 })
    memory: float32 = 2.0;
  }

  alias ContainerDefinitionKind = "acr" | string;

  /**
   * Definition for a container image registry.
   */
  @abstract
  @discriminator("kind")
  model Registry {
    @doc("The kind of container registry")
    @sample(#{ kind: "docker" })
    kind: ContainerDefinitionKind;

    @doc("The connection configuration for accessing the container registry")
    @sample(#{
      connection: #{
        kind: "key",
        authority: "system",
        usageDescription: "Access to the container registry",
      },
    })
    connection: Connection;
  }

  /**
   * Definition for a generic container image registry.
   */
  model GenericRegistry extends Registry {
    @doc("The kind of container registry")
    @sample(#{ kind: "some-value" })
    kind: "*";

    @doc("The URL of the container registry")
    @sample(#{ repository: "https://my-registry.com" })
    repository: string;

    @doc("The username for accessing the container registry")
    @sample(#{ username: "my-username" })
    username?: string;

    @doc("The password for accessing the container registry")
    @sample(#{ password: "my-password" })
    password?: string;
  }

  /**
   * Definition for an Azure Container Registry (ACR).
   */
  model AzureContainerRegistry extends Registry {
    @doc("The kind of container registry")
    @sample(#{ kind: "acr" })
    kind: "acr";

    @doc("The Azure subscription ID for the ACR")
    @sample(#{ subscription: "your-subscription-id" })
    subscription: string;

    @doc("The Azure resource group containing the ACR")
    @sample(#{ resourceGroup: "your-resource-group" })
    resourceGroup: string;

    @doc("The name of the ACR")
    @sample(#{ registryName: "your-acr-name" })
    registryName: string;
  }
}
