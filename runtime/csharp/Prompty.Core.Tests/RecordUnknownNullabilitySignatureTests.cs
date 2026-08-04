// Copyright (c) Microsoft. All rights reserved.

using System.Reflection;
using Prompty.Core;

namespace Prompty.Core.Tests;

public class RecordUnknownNullabilitySignatureTests
{
    [Fact]
    public void RecordUnknownProperties_ExposeCanonicalNullableValueSignatures()
    {
        var cases = new (Type Model, string Property, NullabilityState Presence)[]
        {
            (typeof(Message), nameof(Message.Metadata), NullabilityState.NotNull),
            (typeof(Prompty), nameof(Prompty.Metadata), NullabilityState.Nullable),
            (typeof(ModelInfo), nameof(ModelInfo.AdditionalProperties), NullabilityState.Nullable),
            (typeof(TurnModelRequest), nameof(TurnModelRequest.Inputs), NullabilityState.Nullable),
            (typeof(RunTurnRequest), nameof(RunTurnRequest.Inputs), NullabilityState.Nullable),
            (typeof(TurnModelResponse), nameof(TurnModelResponse.CheckpointState), NullabilityState.Nullable),
            (typeof(HostToolRequest), nameof(HostToolRequest.Arguments), NullabilityState.Nullable),
            (typeof(TurnEvent), nameof(TurnEvent.Payload), NullabilityState.NotNull),
            (typeof(SessionEvent), nameof(SessionEvent.Payload), NullabilityState.NotNull),
        };
        var context = new NullabilityInfoContext();

        foreach (var (model, propertyName, expectedPresence) in cases)
        {
            var property = model.GetProperty(propertyName)
                ?? throw new InvalidOperationException($"{model.Name}.{propertyName} does not exist.");
            Assert.Equal(typeof(IDictionary<,>), property.PropertyType.GetGenericTypeDefinition());

            var nullability = context.Create(property);
            Assert.Equal(expectedPresence, nullability.ReadState);
            Assert.Equal(typeof(string), nullability.GenericTypeArguments[0].Type);
            Assert.Equal(NullabilityState.NotNull, nullability.GenericTypeArguments[0].ReadState);
            Assert.Equal(typeof(object), nullability.GenericTypeArguments[1].Type);
            Assert.Equal(NullabilityState.Nullable, nullability.GenericTypeArguments[1].ReadState);
        }
    }
}
