// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json.Serialization;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;
using YamlDotNet.Serialization;
using YamlDotNet.RepresentationModel;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for an Azure Container Registry (ACR).
/// </summary>
[JsonConverter(typeof(AzureContainerRegistryJsonConverter))]
public class AzureContainerRegistry : Registry, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="AzureContainerRegistry"/>.
    /// </summary>
#pragma warning disable CS8618
    public AzureContainerRegistry()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind of container registry
    /// </summary>
    public override string Kind { get; set; } = "acr";

    /// <summary>
    /// The Azure subscription ID for the ACR
    /// </summary>
    public string Subscription { get; set; } = string.Empty;

    /// <summary>
    /// The Azure resource group containing the ACR
    /// </summary>
    public string ResourceGroup { get; set; } = string.Empty;

    /// <summary>
    /// The name of the ACR
    /// </summary>
    public string RegistryName { get; set; } = string.Empty;


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type AzureContainerRegistry");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("subscription"));
        nestedObjectSerializer(Subscription);

        emitter.Emit(new Scalar("resourceGroup"));
        nestedObjectSerializer(ResourceGroup);

        emitter.Emit(new Scalar("registryName"));
        nestedObjectSerializer(RegistryName);
    }
}
