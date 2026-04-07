// Copyright (c) Microsoft. All rights reserved.

using System.Collections.Concurrent;

namespace Prompty.Core;

/// <summary>
/// Process-global connection registry for pre-configured LLM clients.
/// Per spec §11.1: stores named client instances for reuse across prompts.
/// Executors look up ReferenceConnection.Name here.
/// Thread-safe via ConcurrentDictionary.
/// </summary>
public static class ConnectionRegistry
{
    private static readonly ConcurrentDictionary<string, object> _connections = new();

    /// <summary>Store a named client/connection.</summary>
    public static void Register(string name, object client)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(client);
        _connections[name] = client;
    }

    /// <summary>Retrieve by name; returns null if absent.</summary>
    public static object? Get(string name) =>
        _connections.TryGetValue(name, out var client) ? client : null;

    /// <summary>Remove all entries (for testing).</summary>
    public static void Clear() => _connections.Clear();

    /// <summary>Check if a named connection exists.</summary>
    public static bool Contains(string name) => _connections.ContainsKey(name);

    /// <summary>Remove a specific named connection.</summary>
    public static bool Remove(string name) => _connections.TryRemove(name, out _);
}
