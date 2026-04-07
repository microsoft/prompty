// Copyright (c) Microsoft. All rights reserved.

using System.Collections.Concurrent;

namespace Prompty.Core.Tracing;

/// <summary>
/// The tracer registry. Manages named tracing backends and creates fan-out span emitters.
/// Thread-safe per spec §3.1.
/// </summary>
public static class Tracer
{
    private static readonly ConcurrentDictionary<string, TracerFactory> _factories = new();

    /// <summary>Whether any backends are registered. Fast-path check for tracing no-op.</summary>
    public static bool HasListeners => !_factories.IsEmpty;

    /// <summary>Register a named backend factory.</summary>
    public static void Add(string name, TracerFactory factory)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(factory);
        _factories[name] = factory;
    }

    /// <summary>Unregister a named backend.</summary>
    public static bool Remove(string name) => _factories.TryRemove(name, out _);

    /// <summary>Remove all registered backends.</summary>
    public static void Clear() => _factories.Clear();

    /// <summary>
    /// Open all registered backends and return a fan-out emitter.
    /// Per spec §3.1: invokes every factory, returns composite emitter.
    /// </summary>
    public static SpanEmitter Start(string spanName)
    {
        if (_factories.IsEmpty)
            return SpanEmitter.NoOp;

        var spans = new List<ITracerSpan>();
        foreach (var (_, factory) in _factories)
        {
            try
            {
                spans.Add(factory(spanName));
            }
            catch
            {
                // Per spec: failing backend MUST NOT prevent others
            }
        }

        return new SpanEmitter(spans);
    }
}

/// <summary>
/// Fan-out emitter that forwards (key, value) to all active backend spans.
/// Disposing ends all backend spans.
/// </summary>
public sealed class SpanEmitter : IDisposable
{
    internal static readonly SpanEmitter NoOp = new([]);
    private readonly List<ITracerSpan> _spans;
    private bool _disposed;

    internal SpanEmitter(List<ITracerSpan> spans) => _spans = spans;

    /// <summary>Whether this emitter has any active backends.</summary>
    public bool IsActive => _spans.Count > 0;

    /// <summary>Emit a key-value pair to all backends.</summary>
    public void Emit(string key, object? value)
    {
        if (_disposed) return;
        foreach (var span in _spans)
        {
            try
            {
                span.Emit(key, value);
            }
            catch
            {
                // Per spec: failing backend MUST NOT prevent others
            }
        }
    }

    /// <summary>End all backend spans.</summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var span in _spans)
        {
            try
            {
                span.Dispose();
            }
            catch
            {
                // Per spec: failing backend MUST NOT prevent others
            }
        }
    }
}
