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
/// The following represents a manifest that can be used to create agents dynamically.
/// It includes a list of models that the publisher of the manifest has tested and
/// has confidence will work with an instantiated prompt agent.
/// The manifest also includes parameters that can be used to configure the agent&#39;s behavior.
/// These parameters include values that can be used as publisher parameters that can
/// be used to describe additional variables that have been tested and are known to work.
/// 
/// Variables described here are then used to project into a prompt agent that can be executed.
/// Once parameters are provided, these can be referenced in the manifest using the following notation:
/// 
/// `${param:MyParameter}`
/// 
/// This allows for dynamic configuration of the agent based on the provided parameters.
/// (This notation is used elsewhere, but only the `param` scope is supported here)
/// </summary>
[JsonConverter(typeof(PromptyManifestJsonConverter))]
public class PromptyManifest : Prompty, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyManifest"/>.
    /// </summary>
#pragma warning disable CS8618
    public PromptyManifest()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Type of agent, e.g., 'manifest'
    /// </summary>
    public override string Kind { get; set; } = "manifest";

    /// <summary>
    /// Additional models that are known to work with this prompt
    /// </summary>
    public IList<Model> Models { get; set; } = [];

    /// <summary>
    /// Parameters for configuring the agent's behavior and execution
    /// </summary>
    public IList<Parameter> Parameters { get; set; } = [];


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type PromptyManifest");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("models"));
        nestedObjectSerializer(Models);

        emitter.Emit(new Scalar("parameters"));
        nestedObjectSerializer(Parameters);
    }
}
