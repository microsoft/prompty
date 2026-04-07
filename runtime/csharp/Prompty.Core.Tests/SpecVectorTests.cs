// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Core;

namespace Prompty.Core.Tests;

/// <summary>
/// Spec vector validation tests — loads canonical test vectors from spec/vectors/
/// and verifies the C# runtime produces matching results.
///
/// Vector sources:
/// - load (25) — .prompty file loading
/// - render (23) — template rendering
/// - parse (15) — role marker parsing
/// - wire (27) — tested via WireFormatTests (SDK type mismatch)
/// - process (21) — tested via ProcessorTests (SDK type mismatch)
/// - agent (11) — tested via AgentLoopTests (mocked executor)
/// </summary>
public class SpecVectorTests
{
    // Relative path from test project bin to spec dir
    private static readonly string SpecDir = FindSpecDir();
    private static readonly string VectorsDir = Path.Combine(SpecDir, "vectors");
    private static readonly string FixturesDir = Path.Combine(SpecDir, "fixtures");

    private static string FindSpecDir()
    {
        // Walk up from the test assembly location to find the spec/ directory
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(dir, "spec");
            if (Directory.Exists(candidate))
                return candidate;
            dir = Path.GetDirectoryName(dir) ?? dir;
        }
        // Try relative from project root
        var projectRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
        return Path.Combine(projectRoot, "spec");
    }

    private static JsonElement[] LoadVectors(string stage)
    {
        var path = Path.Combine(VectorsDir, stage, $"{stage}_vectors.json");
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<JsonElement[]>(json) ?? [];
    }

    // =========================================================================
    // RENDER VECTORS
    // =========================================================================

    [Fact]
    public async Task RenderVectors_AllPass()
    {
        var vectors = LoadVectors("render");
        var jinja2Renderer = new Jinja2Renderer();
        var mustacheRenderer = new MustacheRenderer();
        var failures = new List<string>();

        // Known Jinja2.NET compatibility issues
        var knownSkips = new HashSet<string>
        {
            "for_loop", // Jinja2.NET strips whitespace inside for loops differently
        };

        foreach (var vec in vectors)
        {
            var name = vec.GetProperty("name").GetString()!;
            var input = vec.GetProperty("input");
            var expected = vec.GetProperty("expected");

            // Skip thread-related vectors — nonce format differs per runtime
            if (name.Contains("thread") || name.Contains("nonce"))
                continue;

            // Skip vectors with non-standard expected format
            if (!expected.TryGetProperty("rendered", out var renderedEl))
                continue;

            // Skip known compatibility issues
            if (knownSkips.Contains(name))
                continue;

            var template = input.GetProperty("template").GetString()!;
            var engine = input.GetProperty("engine").GetString()!;
            var inputsEl = input.GetProperty("inputs");
            var inputs = JsonElementToDict(inputsEl);

            var expectedRendered = renderedEl.GetString()!;

            var renderer = engine switch
            {
                "jinja2" => (IRenderer)jinja2Renderer,
                "mustache" => (IRenderer)mustacheRenderer,
                _ => throw new InvalidOperationException($"Unknown engine: {engine}"),
            };

            // Create a minimal agent just for rendering
            var agent = new Prompty { Instructions = template };

            try
            {
                var rendered = await renderer.RenderAsync(agent, template, inputs);

                if (rendered != expectedRendered)
                {
                    failures.Add($"[{name}] Expected:\n  {expectedRendered}\nGot:\n  {rendered}");
                }
            }
            catch (Exception ex)
            {
                failures.Add($"[{name}] Exception: {ex.Message}");
            }
        }

        if (failures.Count > 0)
        {
            Assert.Fail($"{failures.Count} render vector(s) failed:\n" + string.Join("\n\n", failures));
        }
    }

    // =========================================================================
    // PARSE VECTORS
    // =========================================================================

    [Fact]
    public async Task ParseVectors_AllPass()
    {
        var vectors = LoadVectors("parse");
        var parser = new PromptyChatParser();
        var failures = new List<string>();

        foreach (var vec in vectors)
        {
            var name = vec.GetProperty("name").GetString()!;
            var input = vec.GetProperty("input");
            var expected = vec.GetProperty("expected");

            var rendered = input.GetProperty("rendered").GetString()!;
            var expectedMessages = expected.GetProperty("messages");

            // Skip thread nonce vectors — these test prepare() not parse()
            if (name.Contains("thread") && rendered.Contains("__PROMPTY_THREAD_"))
            {
                continue;
            }

            var agent = new Prompty();

            try
            {
                var messages = await parser.ParseAsync(agent, rendered);
                var errors = CompareMessages(messages, expectedMessages);

                if (errors.Count > 0)
                {
                    failures.Add($"[{name}] Mismatches:\n  " + string.Join("\n  ", errors));
                }
            }
            catch (Exception ex)
            {
                failures.Add($"[{name}] Exception: {ex.Message}");
            }
        }

        if (failures.Count > 0)
        {
            Assert.Fail($"{failures.Count} parse vector(s) failed:\n" + string.Join("\n\n", failures));
        }
    }

    // =========================================================================
    // LOAD VECTORS
    // =========================================================================

    [Fact]
    public void LoadVectors_AllPass()
    {
        var vectors = LoadVectors("load");
        var failures = new List<string>();
        var skipped = new List<string>();

        // Vectors that require file I/O from inline frontmatter — skip
        var fileRefSkips = new HashSet<string> { "file_resolution" };

        foreach (var vec in vectors)
        {
            var name = vec.GetProperty("name").GetString()!;
            var input = vec.GetProperty("input");
            var expected = vec.GetProperty("expected");

            if (fileRefSkips.Contains(name))
            {
                skipped.Add($"{name} (inline frontmatter with ${'{'}file:{'}'} ref — needs fixture-based loading)");
                continue;
            }
            // Set up env vars if specified
            var savedEnv = new Dictionary<string, string?>();
            if (input.TryGetProperty("env", out var envEl))
            {
                foreach (var prop in envEl.EnumerateObject())
                {
                    savedEnv[prop.Name] = Environment.GetEnvironmentVariable(prop.Name);
                    Environment.SetEnvironmentVariable(prop.Name, prop.Value.GetString());
                }
            }

            try
            {
                // Error cases
                if (expected.TryGetProperty("error", out _))
                {
                    if (input.TryGetProperty("fixture", out var fixture))
                    {
                        var fixtureName = fixture.GetString()!;
                        if (fixtureName == "nonexistent.prompty")
                        {
                            var fixturePath = Path.Combine(FixturesDir, fixtureName);
                            Assert.ThrowsAny<Exception>(() => PromptyLoader.Load(fixturePath));
                            continue;
                        }
                    }
                    // Other error cases — skip for now
                    skipped.Add(name);
                    continue;
                }

                // Normal load from fixture
                if (input.TryGetProperty("fixture", out var fixtureEl))
                {
                    var fixturePath = Path.Combine(FixturesDir, fixtureEl.GetString()!);
                    if (!File.Exists(fixturePath))
                    {
                        skipped.Add($"{name} (fixture not found: {fixtureEl.GetString()})");
                        continue;
                    }

                    var agent = PromptyLoader.Load(fixturePath);

                    var errors = CompareAgentToExpected(agent, expected);
                    if (errors.Count > 0)
                    {
                        failures.Add($"[{name}] Mismatches:\n  " + string.Join("\n  ", errors));
                    }
                }
                else if (input.TryGetProperty("frontmatter", out var frontmatterEl))
                {
                    // Load from inline frontmatter with reference resolution
                    var data = JsonElementToDict(frontmatterEl);
                    if (!data.ContainsKey("kind"))
                        data["kind"] = "prompt";

                    var ctx = new LoadContext
                    {
                        PreProcess = d => ReferenceResolver.ResolveReferences(d, "."),
                    };

                    var agent = Prompty.Load(data, ctx);

                    var errors = CompareAgentToExpected(agent, expected);
                    if (errors.Count > 0)
                    {
                        failures.Add($"[{name}] Mismatches:\n  " + string.Join("\n  ", errors));
                    }
                }
                else
                {
                    skipped.Add($"{name} (no fixture or frontmatter)");
                }
            }
            catch (Exception ex) when (expected.TryGetProperty("error", out _))
            {
                // Expected error — ok
            }
            catch (Exception ex)
            {
                failures.Add($"[{name}] Exception: {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                // Restore env vars
                foreach (var (key, val) in savedEnv)
                {
                    Environment.SetEnvironmentVariable(key, val);
                }
            }
        }

        if (failures.Count > 0)
        {
            Assert.Fail($"{failures.Count} load vector(s) failed (skipped {skipped.Count}):\n" +
                string.Join("\n\n", failures));
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private static Dictionary<string, object?> JsonElementToDict(JsonElement el)
    {
        var dict = new Dictionary<string, object?>();
        if (el.ValueKind != JsonValueKind.Object) return dict;

        foreach (var prop in el.EnumerateObject())
        {
            dict[prop.Name] = JsonElementToObject(prop.Value);
        }
        return dict;
    }

    private static object? JsonElementToObject(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.String => el.GetString(),
        JsonValueKind.Number => el.TryGetInt64(out var l) ? (l == (int)l ? (object)(int)l : l) : el.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        JsonValueKind.Array => el.EnumerateArray().Select(JsonElementToObject).ToList(),
        JsonValueKind.Object => JsonElementToDict(el),
        _ => el.GetRawText(),
    };

    private static List<string> CompareMessages(List<Message> actual, JsonElement expected)
    {
        var errors = new List<string>();
        var expectedArray = expected.EnumerateArray().ToList();

        if (actual.Count != expectedArray.Count)
        {
            errors.Add($"message count: expected {expectedArray.Count}, got {actual.Count}");
            return errors;
        }

        for (var i = 0; i < actual.Count; i++)
        {
            var actualMsg = actual[i];
            var expectedMsg = expectedArray[i];

            // Compare role
            var expectedRole = expectedMsg.GetProperty("role").GetString();
            if (actualMsg.Role != expectedRole)
            {
                errors.Add($"[{i}].role: expected '{expectedRole}', got '{actualMsg.Role}'");
            }

            // Compare content (text)
            if (expectedMsg.TryGetProperty("content", out var contentEl))
            {
                if (contentEl.ValueKind == JsonValueKind.Array)
                {
                    var parts = contentEl.EnumerateArray().ToList();
                    if (parts.Count == 1 && parts[0].TryGetProperty("kind", out var kindEl) && kindEl.GetString() == "text")
                    {
                        var expectedText = parts[0].GetProperty("value").GetString()?.Trim();
                        var actualText = actualMsg.Text.Trim();
                        if (actualText != expectedText)
                        {
                            errors.Add($"[{i}].content: expected '{Truncate(expectedText)}', got '{Truncate(actualText)}'");
                        }
                    }
                }
            }
        }

        return errors;
    }

    private static List<string> CompareAgentToExpected(Prompty agent, JsonElement expected)
    {
        var errors = new List<string>();

        if (expected.TryGetProperty("name", out var nameEl))
        {
            if (agent.Name != nameEl.GetString())
                errors.Add($"name: expected '{nameEl.GetString()}', got '{agent.Name}'");
        }

        if (expected.TryGetProperty("description", out var descEl))
        {
            if (agent.Description != descEl.GetString())
                errors.Add($"description: expected '{descEl.GetString()}', got '{agent.Description}'");
        }

        if (expected.TryGetProperty("instructions", out var instrEl))
        {
            var expectedInstr = NormalizeWhitespace(instrEl.GetString());
            var actualInstr = NormalizeWhitespace(agent.Instructions);
            if (actualInstr != expectedInstr)
                errors.Add($"instructions: expected '{Truncate(expectedInstr)}', got '{Truncate(actualInstr)}'");
        }

        if (expected.TryGetProperty("model", out var modelEl))
        {
            if (modelEl.ValueKind == JsonValueKind.Null)
            {
                // Expected null — actual should also be null
                if (agent.Model is not null)
                    errors.Add("model: expected null, got non-null");
            }
            else if (agent.Model is null)
            {
                errors.Add("model: expected non-null, got null");
            }
            else
            {
                if (modelEl.TryGetProperty("id", out var idEl) && agent.Model.Id != idEl.GetString())
                    errors.Add($"model.id: expected '{idEl.GetString()}', got '{agent.Model.Id}'");

                if (modelEl.TryGetProperty("provider", out var provEl) && agent.Model.Provider != provEl.GetString())
                    errors.Add($"model.provider: expected '{provEl.GetString()}', got '{agent.Model.Provider}'");

                if (modelEl.TryGetProperty("apiType", out var apiEl) && agent.Model.ApiType != apiEl.GetString())
                    errors.Add($"model.apiType: expected '{apiEl.GetString()}', got '{agent.Model.ApiType}'");

                if (modelEl.TryGetProperty("connection", out var connEl) && agent.Model.Connection is not null)
                {
                    if (connEl.TryGetProperty("kind", out var kindEl))
                    {
                        var actualKind = agent.Model.Connection switch
                        {
                            ApiKeyConnection => "key",
                            ReferenceConnection => "reference",
                            AnonymousConnection => "anonymous",
                            _ => "unknown",
                        };
                        if (actualKind != kindEl.GetString())
                            errors.Add($"model.connection.kind: expected '{kindEl.GetString()}', got '{actualKind}'");
                    }

                    if (connEl.TryGetProperty("endpoint", out var epEl) && agent.Model.Connection is ApiKeyConnection akc)
                    {
                        if (akc.Endpoint != epEl.GetString())
                            errors.Add($"model.connection.endpoint: expected '{epEl.GetString()}', got '{akc.Endpoint}'");
                    }

                    if (connEl.TryGetProperty("apiKey", out var akEl) && agent.Model.Connection is ApiKeyConnection akc2)
                    {
                        if (akc2.ApiKey != akEl.GetString())
                            errors.Add($"model.connection.apiKey: expected '{akEl.GetString()}', got '{akc2.ApiKey}'");
                    }
                }

                if (modelEl.TryGetProperty("options", out var optsEl) && agent.Model.Options is not null)
                {
                    var opts = agent.Model.Options;
                    if (optsEl.TryGetProperty("temperature", out var tempEl))
                    {
                        if (Math.Abs((opts.Temperature ?? 0f) - (float)tempEl.GetDouble()) > 0.001f)
                            errors.Add($"model.options.temperature: expected {tempEl.GetDouble()}, got {opts.Temperature}");
                    }
                    if (optsEl.TryGetProperty("maxOutputTokens", out var motEl))
                    {
                        if (opts.MaxOutputTokens != motEl.GetInt64())
                            errors.Add($"model.options.maxOutputTokens: expected {motEl.GetInt64()}, got {opts.MaxOutputTokens}");
                    }
                }
            }
        }

        return errors;
    }

    private static string? NormalizeWhitespace(string? s)
    {
        if (s is null) return null;
        // Normalize line endings and trim trailing whitespace per line
        return string.Join("\n", s.Replace("\r\n", "\n").TrimEnd().Split('\n').Select(l => l.TrimEnd()));
    }

    private static string? Truncate(string? s, int maxLen = 80)
    {
        if (s is null) return null;
        return s.Length <= maxLen ? s : s[..maxLen] + "...";
    }
}
