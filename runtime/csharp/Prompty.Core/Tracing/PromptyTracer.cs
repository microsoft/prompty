// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prompty.Core.Tracing;

/// <summary>
/// .tracy file backend per spec §3.6.1.
/// Accumulates span data in a tree structure; root span writes JSON to disk on dispose.
/// </summary>
public class PromptyTracer
{
    private readonly string _outputDir;
    private readonly AsyncLocal<Stack<SpanFrame>> _stack = new();

    /// <summary>
    /// Create a PromptyTracer that writes .tracy files to the specified directory.
    /// </summary>
    public PromptyTracer(string? outputDir = null)
    {
        _outputDir = outputDir ?? System.IO.Path.Combine(Directory.GetCurrentDirectory(), ".runs");
    }

    /// <summary>
    /// Returns a <see cref="TracerFactory"/> that can be registered with <see cref="Tracer.Add"/>.
    /// </summary>
    public TracerFactory Factory => spanName => new PromptyTracerSpan(this, spanName);

    /// <summary>
    /// Register this tracer with the global <see cref="Tracer"/> registry.
    /// </summary>
    public void Register(string name = "prompty")
    {
        Tracer.Add(name, Factory);
    }

    // -------------------------------------------------------------------
    // Stack management (per async context)
    // -------------------------------------------------------------------

    private Stack<SpanFrame> GetStack()
    {
        _stack.Value ??= new Stack<SpanFrame>();
        return _stack.Value;
    }

    internal SpanFrame PushFrame(string name)
    {
        var stack = GetStack();
        var frame = new SpanFrame(name);
        stack.Push(frame);
        return frame;
    }

    internal SpanFrame? PopFrame()
    {
        var stack = GetStack();
        if (stack.Count == 0) return null;

        var frame = stack.Pop();
        frame.EndTime = DateTime.UtcNow;

        // Hoist usage per spec §3.5
        HoistUsage(frame);

        if (stack.Count > 0)
        {
            // Attach to parent's __frames
            stack.Peek().Children.Add(frame);
            return frame;
        }

        // Root span — write .tracy file
        WriteTracyFile(frame);
        return frame;
    }

    // -------------------------------------------------------------------
    // Usage hoisting (spec §3.5)
    // -------------------------------------------------------------------

    private static void HoistUsage(SpanFrame frame)
    {
        // Check if result has usage info
        if (frame.Data.TryGetValue("result", out var resultVal) && resultVal is IDictionary<string, object?> resultDict)
        {
            if (resultDict.TryGetValue("usage", out var usageVal) && usageVal is IDictionary<string, object?> usageDict)
            {
                frame.Usage.PromptTokens += GetLong(usageDict, "prompt_tokens") ?? GetLong(usageDict, "input_tokens") ?? 0;
                frame.Usage.CompletionTokens += GetLong(usageDict, "completion_tokens") ?? GetLong(usageDict, "output_tokens") ?? 0;
                frame.Usage.TotalTokens += GetLong(usageDict, "total_tokens") ?? 0;
            }
        }

        // Aggregate children
        foreach (var child in frame.Children)
        {
            frame.Usage.PromptTokens += child.Usage.PromptTokens;
            frame.Usage.CompletionTokens += child.Usage.CompletionTokens;
            frame.Usage.TotalTokens += child.Usage.TotalTokens;
        }
    }

    private static long? GetLong(IDictionary<string, object?> dict, string key)
    {
        if (!dict.TryGetValue(key, out var val) || val is null) return null;
        return val switch
        {
            long l => l,
            int i => i,
            double d => (long)d,
            _ => long.TryParse(val.ToString(), out var parsed) ? parsed : null,
        };
    }

    // -------------------------------------------------------------------
    // .tracy file output (spec §3.6.1)
    // -------------------------------------------------------------------

    private void WriteTracyFile(SpanFrame rootFrame)
    {
        try
        {
            Directory.CreateDirectory(_outputDir);

            var sanitizedName = SanitizeFileName(rootFrame.Name);
            var timestamp = rootFrame.EndTime.ToString("yyyyMMdd.HHmmss");
            var fileName = $"{sanitizedName}.{timestamp}.tracy";
            var filePath = System.IO.Path.Combine(_outputDir, fileName);

            var envelope = new Dictionary<string, object?>
            {
                ["runtime"] = "csharp",
                ["version"] = "2.0.0",
                ["trace"] = FrameToDict(rootFrame),
            };

            var json = JsonSerializer.Serialize(envelope, TracyJsonOptions);
            File.WriteAllText(filePath, json);
        }
        catch
        {
            // Backend must not crash the pipeline
        }
    }

    internal static Dictionary<string, object?> FrameToDict(SpanFrame frame)
    {
        var dict = new Dictionary<string, object?>
        {
            ["name"] = frame.Name,
            ["__time"] = new Dictionary<string, object?>
            {
                ["start"] = frame.StartTime.ToString("O"),
                ["end"] = frame.EndTime.ToString("O"),
                ["duration"] = (frame.EndTime - frame.StartTime).TotalMilliseconds,
            },
        };

        // Copy user-emitted data (signature, inputs, result, etc.)
        foreach (var (key, value) in frame.Data)
        {
            dict[key] = value;
        }

        // Child frames
        dict["__frames"] = frame.Children.Select(FrameToDict).ToList();

        // Usage (only if non-zero)
        if (frame.Usage.TotalTokens > 0 || frame.Usage.PromptTokens > 0 || frame.Usage.CompletionTokens > 0)
        {
            dict["__usage"] = new Dictionary<string, object?>
            {
                ["prompt_tokens"] = frame.Usage.PromptTokens,
                ["completion_tokens"] = frame.Usage.CompletionTokens,
                ["total_tokens"] = frame.Usage.TotalTokens,
            };
        }

        return dict;
    }

    private static string SanitizeFileName(string name)
    {
        var invalid = System.IO.Path.GetInvalidFileNameChars();
        return new string(name.Select(c => Array.IndexOf(invalid, c) >= 0 ? '_' : c).ToArray());
    }

    private static readonly JsonSerializerOptions TracyJsonOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

/// <summary>
/// A span frame in the trace tree. Accumulates data and child frames.
/// </summary>
public class SpanFrame
{
    public string Name { get; }
    public DateTime StartTime { get; } = DateTime.UtcNow;
    public DateTime EndTime { get; internal set; }
    public Dictionary<string, object?> Data { get; } = [];
    public List<SpanFrame> Children { get; } = [];
    public UsageInfo Usage { get; } = new();

    public SpanFrame(string name) => Name = name;
}

/// <summary>
/// Aggregated token usage information per spec §3.5.
/// </summary>
public class UsageInfo
{
    public long PromptTokens { get; set; }
    public long CompletionTokens { get; set; }
    public long TotalTokens { get; set; }
}

/// <summary>
/// ITracerSpan implementation for the PromptyTracer backend.
/// </summary>
internal sealed class PromptyTracerSpan : ITracerSpan
{
    private readonly PromptyTracer _tracer;
    private readonly SpanFrame _frame;

    public PromptyTracerSpan(PromptyTracer tracer, string spanName)
    {
        _tracer = tracer;
        _frame = tracer.PushFrame(spanName);
    }

    public void Emit(string key, object? value)
    {
        _frame.Data[key] = value;
    }

    public void Dispose()
    {
        _tracer.PopFrame();
    }
}
