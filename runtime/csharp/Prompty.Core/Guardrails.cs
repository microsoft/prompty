// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>Error thrown when a guardrail denies the operation.</summary>
public class GuardrailError : Exception
{
    public string Reason { get; }
    public GuardrailError(string reason) : base($"Guardrail denied: {reason}")
    {
        Reason = reason;
    }
}

/// <summary>§13.4 Guardrails — optional validation hooks for the agent loop.</summary>
public class Guardrails
{
    private readonly Func<List<Message>, GuardrailResult>? _inputHook;
    private readonly Func<Message, GuardrailResult>? _outputHook;
    private readonly Func<string, Dictionary<string, object?>, GuardrailResult>? _toolHook;

    public Guardrails(
        Func<List<Message>, GuardrailResult>? input = null,
        Func<Message, GuardrailResult>? output = null,
        Func<string, Dictionary<string, object?>, GuardrailResult>? tool = null)
    {
        _inputHook = input;
        _outputHook = output;
        _toolHook = tool;
    }

    public GuardrailResult CheckInput(List<Message> messages)
        => _inputHook?.Invoke(messages) ?? new GuardrailResult(true);

    public GuardrailResult CheckOutput(Message message)
        => _outputHook?.Invoke(message) ?? new GuardrailResult(true);

    public GuardrailResult CheckTool(string name, Dictionary<string, object?> args)
        => _toolHook?.Invoke(name, args) ?? new GuardrailResult(true);
}
