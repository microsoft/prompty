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
/// A workflow agent that can orchestrate multiple steps and actions.
/// This agent type is designed to handle complex workflows that may involve
/// multiple tools, models, and decision points.
/// 
/// The workflow agent can be configured with a series of steps that define
/// the flow of execution, including conditional logic and parallel processing.
/// This allows for the creation of sophisticated AI-driven processes that can
/// adapt to various scenarios and requirements.
/// 
/// Note: The detailed structure of the workflow steps and actions is not defined here
/// and would need to be implemented based on specific use cases and requirements.
/// </summary>
[JsonConverter(typeof(PromptyWorkflowJsonConverter))]
public class PromptyWorkflow : PromptyBase, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyWorkflow"/>.
    /// </summary>
#pragma warning disable CS8618
    public PromptyWorkflow()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Type of agent, e.g., 'workflow'
    /// </summary>
    public override string Kind { get; set; } = "workflow";

    /// <summary>
    /// The steps that make up the workflow
    /// </summary>
    public IDictionary<string, object>? Trigger { get; set; }


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type PromptyWorkflow");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        if (Trigger != null)
        {
            emitter.Emit(new Scalar("trigger"));
            nestedObjectSerializer(Trigger);
        }

    }
}
