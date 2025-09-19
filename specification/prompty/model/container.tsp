import "./connection.tsp";

namespace Prompty.Core {
  model EnvironmentVariable {
    @doc("Environment variable resolution")
    value: string;
  }

  alias EnvironmentVariables = Record<EnvironmentVariable> | Named<
    EnvironmentVariable,
    "Name of the environment variable",
    #{ name: "MY_ENV_VAR" }
  >[];

  model ContainerDefinition {
    image: string;
    tag?: string = "latest";

    @doc("Container image registry definition")
    registry: Registry;

    @doc("Instance scaling configuration")
    scale: Scale;
  }

  model Scale {
    @doc("Minimum number of container instances to run")
    @sample(#{ minReplicas: 1 })
    minReplicas?: integer = 1;

    @doc("Maximum number of container instances to run")
    @sample(#{ maxReplicas: 5 })
    maxReplicas?: integer = 5;

    @doc("CPU allocation per instance (in cores)")
    @sample(#{ cpu: 0.5 })
    cpu: float = 0.5;

    @doc("Memory allocation per instance (in GB)")
    @sample(#{ memory: 2.0 })
    memory: float = 2.0;
  }

  alias ContainerDefinitionKind = "acr" | string;

  @discriminator("kind")
  model Registry {
    kind: ContainerDefinitionKind;
    connection: Connection;
  }

  model AzureContainerRegistry extends Registry {
    kind: "acr";
    subscription: string;
    resourceGroup: string;
    registryName: string;
  }
}
