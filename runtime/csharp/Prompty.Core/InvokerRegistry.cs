// Copyright (c) Microsoft. All rights reserved.

using System.Collections.Concurrent;

namespace Prompty.Core;

/// <summary>
/// Thrown when a required invoker (renderer, parser, executor, or processor) is not registered.
/// </summary>
public class InvokerError : InvalidOperationException
{
    public string Group { get; }
    public string Key { get; }

    public InvokerError(string group, string key)
        : base($"No {group} registered for '{key}'. Register one via InvokerRegistry.Register{GetFriendlyGroup(group)}().")
    {
        Group = group;
        Key = key;
    }

    private static string GetFriendlyGroup(string group) => group switch
    {
        "renderer" => "Renderer",
        "parser" => "Parser",
        "executor" => "Executor",
        "processor" => "Processor",
        _ => group,
    };
}

/// <summary>
/// Registry for pipeline invokers. Implementations are registered by string key
/// and looked up at runtime during pipeline execution.
/// </summary>
public static class InvokerRegistry
{
    private static readonly ConcurrentDictionary<string, IRenderer> _renderers = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, IParser> _parsers = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, IExecutor> _executors = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, IProcessor> _processors = new(StringComparer.OrdinalIgnoreCase);

    // --- Registration ---

    public static void RegisterRenderer(string key, IRenderer renderer)
        => _renderers[key] = renderer;

    public static void RegisterParser(string key, IParser parser)
        => _parsers[key] = parser;

    public static void RegisterExecutor(string key, IExecutor executor)
        => _executors[key] = executor;

    public static void RegisterProcessor(string key, IProcessor processor)
        => _processors[key] = processor;

    // --- Lookup ---

    public static IRenderer GetRenderer(string key)
        => _renderers.TryGetValue(key, out var r) ? r : throw new InvokerError("renderer", key);

    public static IParser GetParser(string key)
        => _parsers.TryGetValue(key, out var p) ? p : throw new InvokerError("parser", key);

    public static IExecutor GetExecutor(string key)
        => _executors.TryGetValue(key, out var e) ? e : throw new InvokerError("executor", key);

    public static IProcessor GetProcessor(string key)
        => _processors.TryGetValue(key, out var p) ? p : throw new InvokerError("processor", key);

    // --- Query ---

    public static bool HasRenderer(string key) => _renderers.ContainsKey(key);
    public static bool HasParser(string key) => _parsers.ContainsKey(key);
    public static bool HasExecutor(string key) => _executors.ContainsKey(key);
    public static bool HasProcessor(string key) => _processors.ContainsKey(key);

    // --- Reset ---

    /// <summary>
    /// Clears all registered invokers. Primarily for testing.
    /// </summary>
    public static void Clear()
    {
        _renderers.Clear();
        _parsers.Clear();
        _executors.Clear();
        _processors.Clear();
    }
}
