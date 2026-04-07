// Copyright (c) Microsoft. All rights reserved.

using System.Diagnostics;
using System.Runtime.CompilerServices;

namespace Prompty.Core.Tracing;

/// <summary>
/// Higher-order tracing wrappers — the C# equivalent of Python's @trace decorator.
/// Provides Wrap() for delegate wrapping and TraceAsync() for lambda-based tracing.
/// Per spec §3.2.
/// </summary>
public static class Trace
{
    // -----------------------------------------------------------------------
    // TraceAsync — lambda wrapper with auto error capture
    // -----------------------------------------------------------------------

    /// <summary>
    /// Execute a function within a traced span with auto error capture.
    /// The emit callback lets you record custom data.
    /// </summary>
    public static async Task<TResult> TraceAsync<TResult>(
        string name,
        Func<Action<string, object?>, Task<TResult>> fn)
    {
        if (!Tracer.HasListeners)
        {
            // No-op fast path — still call fn with a dummy emitter
            return await fn((_, _) => { });
        }

        using var emitter = Tracer.Start(name);
        emitter.Emit("signature", name);

        try
        {
            var result = await fn((key, value) => emitter.Emit(key, TraceSerializer.ToDict(value)));
            emitter.Emit("result", TraceSerializer.ToDict(result));
            return result;
        }
        catch (Exception ex)
        {
            emitter.Emit("result", TraceSerializer.ToDict(ex));
            throw;
        }
    }

    /// <summary>
    /// Execute a void async function within a traced span.
    /// </summary>
    public static async Task TraceAsync(
        string name,
        Func<Action<string, object?>, Task> fn)
    {
        if (!Tracer.HasListeners)
        {
            await fn((_, _) => { });
            return;
        }

        using var emitter = Tracer.Start(name);
        emitter.Emit("signature", name);

        try
        {
            await fn((key, value) => emitter.Emit(key, TraceSerializer.ToDict(value)));
        }
        catch (Exception ex)
        {
            emitter.Emit("result", TraceSerializer.ToDict(ex));
            throw;
        }
    }

    // -----------------------------------------------------------------------
    // Wrap — higher-order function (C# @trace equivalent)
    // -----------------------------------------------------------------------

    /// <summary>
    /// Wrap an async function with tracing. Captures inputs and result automatically.
    /// This is the C# equivalent of Python's <c>@trace</c> decorator.
    /// </summary>
    public static Func<Task<TResult>> Wrap<TResult>(
        string name,
        Func<Task<TResult>> fn)
    {
        return async () =>
        {
            if (!Tracer.HasListeners) return await fn();

            using var emitter = Tracer.Start(name);
            emitter.Emit("signature", name);

            try
            {
                var result = await fn();
                emitter.Emit("result", TraceSerializer.ToDict(result));
                return result;
            }
            catch (Exception ex)
            {
                emitter.Emit("result", TraceSerializer.ToDict(ex));
                throw;
            }
        };
    }

    /// <summary>Wrap an async function with 1 parameter.</summary>
    public static Func<T1, Task<TResult>> Wrap<T1, TResult>(
        string name,
        Func<T1, Task<TResult>> fn,
        string? param1Name = null)
    {
        return async (arg1) =>
        {
            if (!Tracer.HasListeners) return await fn(arg1);

            using var emitter = Tracer.Start(name);
            emitter.Emit("signature", name);
            emitter.Emit("inputs", TraceSerializer.ToDict(
                new Dictionary<string, object?> { [param1Name ?? "arg1"] = arg1 }));

            try
            {
                var result = await fn(arg1);
                emitter.Emit("result", TraceSerializer.ToDict(result));
                return result;
            }
            catch (Exception ex)
            {
                emitter.Emit("result", TraceSerializer.ToDict(ex));
                throw;
            }
        };
    }

    /// <summary>Wrap an async function with 2 parameters.</summary>
    public static Func<T1, T2, Task<TResult>> Wrap<T1, T2, TResult>(
        string name,
        Func<T1, T2, Task<TResult>> fn,
        string? param1Name = null,
        string? param2Name = null)
    {
        return async (arg1, arg2) =>
        {
            if (!Tracer.HasListeners) return await fn(arg1, arg2);

            using var emitter = Tracer.Start(name);
            emitter.Emit("signature", name);
            emitter.Emit("inputs", TraceSerializer.ToDict(new Dictionary<string, object?>
            {
                [param1Name ?? "arg1"] = arg1,
                [param2Name ?? "arg2"] = arg2,
            }));

            try
            {
                var result = await fn(arg1, arg2);
                emitter.Emit("result", TraceSerializer.ToDict(result));
                return result;
            }
            catch (Exception ex)
            {
                emitter.Emit("result", TraceSerializer.ToDict(ex));
                throw;
            }
        };
    }

    /// <summary>Wrap an async function with 3 parameters.</summary>
    public static Func<T1, T2, T3, Task<TResult>> Wrap<T1, T2, T3, TResult>(
        string name,
        Func<T1, T2, T3, Task<TResult>> fn,
        string? param1Name = null,
        string? param2Name = null,
        string? param3Name = null)
    {
        return async (arg1, arg2, arg3) =>
        {
            if (!Tracer.HasListeners) return await fn(arg1, arg2, arg3);

            using var emitter = Tracer.Start(name);
            emitter.Emit("signature", name);
            emitter.Emit("inputs", TraceSerializer.ToDict(new Dictionary<string, object?>
            {
                [param1Name ?? "arg1"] = arg1,
                [param2Name ?? "arg2"] = arg2,
                [param3Name ?? "arg3"] = arg3,
            }));

            try
            {
                var result = await fn(arg1, arg2, arg3);
                emitter.Emit("result", TraceSerializer.ToDict(result));
                return result;
            }
            catch (Exception ex)
            {
                emitter.Emit("result", TraceSerializer.ToDict(ex));
                throw;
            }
        };
    }

    /// <summary>Wrap an async function with 4 parameters.</summary>
    public static Func<T1, T2, T3, T4, Task<TResult>> Wrap<T1, T2, T3, T4, TResult>(
        string name,
        Func<T1, T2, T3, T4, Task<TResult>> fn,
        string? param1Name = null,
        string? param2Name = null,
        string? param3Name = null,
        string? param4Name = null)
    {
        return async (arg1, arg2, arg3, arg4) =>
        {
            if (!Tracer.HasListeners) return await fn(arg1, arg2, arg3, arg4);

            using var emitter = Tracer.Start(name);
            emitter.Emit("signature", name);
            emitter.Emit("inputs", TraceSerializer.ToDict(new Dictionary<string, object?>
            {
                [param1Name ?? "arg1"] = arg1,
                [param2Name ?? "arg2"] = arg2,
                [param3Name ?? "arg3"] = arg3,
                [param4Name ?? "arg4"] = arg4,
            }));

            try
            {
                var result = await fn(arg1, arg2, arg3, arg4);
                emitter.Emit("result", TraceSerializer.ToDict(result));
                return result;
            }
            catch (Exception ex)
            {
                emitter.Emit("result", TraceSerializer.ToDict(ex));
                throw;
            }
        };
    }
}
