// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core.Tracing;

/// <summary>
/// Console tracer backend per spec §3.6.2.
/// Prints span start/end events to stderr.
/// </summary>
public class ConsoleTracer
{
    /// <summary>
    /// Returns a <see cref="TracerFactory"/> that can be registered with <see cref="Tracer.Add"/>.
    /// </summary>
    public static TracerFactory Factory => spanName => new ConsoleTracerSpan(spanName);

    /// <summary>
    /// Register the console tracer with the global <see cref="Tracer"/> registry.
    /// </summary>
    public static void Register(string name = "console")
    {
        Tracer.Add(name, Factory);
    }
}

internal sealed class ConsoleTracerSpan : ITracerSpan
{
    private readonly string _name;
    private readonly DateTime _start = DateTime.UtcNow;

    public ConsoleTracerSpan(string name)
    {
        _name = name;
        Console.Error.WriteLine($"[prompty] ▶ {name}");
    }

    public void Emit(string key, object? value)
    {
        // Console tracer is minimal — only key events logged
    }

    public void Dispose()
    {
        var duration = (DateTime.UtcNow - _start).TotalMilliseconds;
        Console.Error.WriteLine($"[prompty] ◀ {_name} ({duration:F0}ms)");
    }
}
