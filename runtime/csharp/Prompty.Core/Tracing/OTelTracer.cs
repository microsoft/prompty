// Copyright (c) Microsoft. All rights reserved.

using System.Diagnostics;

namespace Prompty.Core.Tracing;

/// <summary>
/// OpenTelemetry-compatible tracing backend using System.Diagnostics.Activity.
/// Creates Activity spans that are automatically collected by any configured
/// OpenTelemetry SDK exporter.
///
/// Usage:
/// <code>
/// OTelTracer.Register();
/// // Then configure OpenTelemetry SDK in your host to listen to "Prompty" source
/// </code>
///
/// The user's OpenTelemetry SDK configuration should include:
/// <code>
/// builder.Services.AddOpenTelemetry()
///     .WithTracing(b => b.AddSource("Prompty"));
/// </code>
/// </summary>
public static class OTelTracer
{
    private static readonly ActivitySource _source = new("Prompty", "2.0.0");

    /// <summary>
    /// Register the OTel tracer backend with the Prompty tracer registry.
    /// </summary>
    /// <param name="name">The name to register under (default: "otel").</param>
    public static void Register(string name = "otel")
    {
        Tracer.Add(name, Factory);
    }

    private static ITracerSpan Factory(string spanName) => new OTelSpan(spanName);

    private sealed class OTelSpan : ITracerSpan
    {
        private readonly Activity? _activity;

        public OTelSpan(string spanName)
        {
            _activity = _source.StartActivity(spanName, ActivityKind.Internal);
        }

        public void Emit(string key, object? value)
        {
            if (_activity is null) return;

            switch (key)
            {
                case "__error" or "error":
                    _activity.SetStatus(ActivityStatusCode.Error, value?.ToString());
                    if (value is Exception ex)
                    {
                        _activity.SetTag("error.type", ex.GetType().FullName);
                        _activity.SetTag("error.message", ex.Message);
                        _activity.AddEvent(new ActivityEvent("exception", tags: new ActivityTagsCollection
                        {
                            ["exception.type"] = ex.GetType().FullName,
                            ["exception.message"] = ex.Message,
                            ["exception.stacktrace"] = ex.StackTrace,
                        }));
                    }
                    else
                    {
                        _activity.SetTag("error.message", value?.ToString());
                    }
                    break;

                case "result":
                    _activity.SetTag("prompty.result", Truncate(value?.ToString() ?? ""));
                    break;

                case "inputs":
                    FlattenToTags(_activity, "prompty.inputs", value);
                    break;

                case "signature":
                    _activity.SetTag("prompty.signature", value?.ToString());
                    break;

                default:
                    _activity.SetTag($"prompty.{key}", Truncate(value?.ToString() ?? ""));
                    break;
            }
        }

        public void Dispose()
        {
            _activity?.Dispose();
        }

        private static void FlattenToTags(Activity activity, string prefix, object? value)
        {
            if (value is IDictionary<string, object?> dict)
            {
                foreach (var (k, v) in dict)
                {
                    activity.SetTag($"{prefix}.{k}", Truncate(v?.ToString() ?? ""));
                }
            }
            else
            {
                activity.SetTag(prefix, Truncate(value?.ToString() ?? ""));
            }
        }

        private static string Truncate(string s, int maxLen = 4096)
            => s.Length > maxLen ? s[..maxLen] + "..." : s;
    }
}
