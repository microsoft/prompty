// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core.Tracing;

/// <summary>
/// A single span backend instance created by a <see cref="TracerFactory"/>.
/// Receives (key, value) emissions and flushes on dispose.
/// </summary>
public interface ITracerSpan : IDisposable
{
    /// <summary>
    /// Emit a key-value pair into this span.
    /// </summary>
    void Emit(string key, object? value);
}

/// <summary>
/// Factory that creates a span backend for a given span name.
/// Per spec §3.1: <c>factory: (spanName) → ContextManager&lt;(key, value) → void&gt;</c>
/// </summary>
public delegate ITracerSpan TracerFactory(string spanName);
