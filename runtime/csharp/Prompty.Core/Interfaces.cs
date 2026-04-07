// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Renders a PromptAgent's instructions template with input values.
/// Registered by template format kind (e.g., "jinja2", "mustache").
/// </summary>
public interface IRenderer
{
    Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs);
}

/// <summary>
/// Parses rendered text into a list of Messages.
/// Registered by parser kind (e.g., "prompty").
/// </summary>
public interface IParser
{
    Task<List<Message>> ParseAsync(Prompty agent, string rendered);
}

/// <summary>
/// Optional interface for parsers that can sanitize templates before rendering.
/// When implemented, the pipeline calls PreRender first to get a cleaned template
/// and context dict, then renders, then parses with that context.
/// </summary>
public interface IPreRenderable
{
    (string template, Dictionary<string, object?> context) PreRender(string template);
}

/// <summary>
/// Executes an LLM call with prepared messages.
/// Registered by provider name (e.g., "openai", "foundry", "anthropic").
/// </summary>
public interface IExecutor
{
    Task<object> ExecuteAsync(Prompty agent, List<Message> messages);
}

/// <summary>
/// Post-processes raw LLM responses into a final result.
/// Registered by provider name (e.g., "openai", "foundry", "anthropic").
/// </summary>
public interface IProcessor
{
    Task<object> ProcessAsync(Prompty agent, object response);
}
