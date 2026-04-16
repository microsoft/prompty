// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core.Tracing;

namespace Prompty.Core.Tests;

/// <summary>
/// Tests for the tracing infrastructure: Tracer registry, SpanEmitter, TraceSerializer,
/// PromptyTracer, ConsoleTracer, and Trace.Wrap/TraceAsync.
/// </summary>
[Collection("Tracing")]
public class TracingTests : IDisposable
{
    public TracingTests()
    {
        Tracer.Clear();
    }

    public void Dispose()
    {
        Tracer.Clear();
    }

    // -----------------------------------------------------------------------
    // Tracer Registry
    // -----------------------------------------------------------------------

    [Fact]
    public void Tracer_HasListeners_FalseWhenEmpty()
    {
        Assert.False(Tracer.HasListeners);
    }

    [Fact]
    public void Tracer_Add_SetsHasListeners()
    {
        Tracer.Add("test", _ => new TestSpan());
        Assert.True(Tracer.HasListeners);
    }

    [Fact]
    public void Tracer_Remove_ClearsListener()
    {
        Tracer.Add("test", _ => new TestSpan());
        Tracer.Remove("test");
        Assert.False(Tracer.HasListeners);
    }

    [Fact]
    public void Tracer_Clear_RemovesAll()
    {
        Tracer.Add("a", _ => new TestSpan());
        Tracer.Add("b", _ => new TestSpan());
        Tracer.Clear();
        Assert.False(Tracer.HasListeners);
    }

    [Fact]
    public void Tracer_Start_ReturnsNoOp_WhenNoListeners()
    {
        var emitter = Tracer.Start("test");
        Assert.False(emitter.IsActive);
        emitter.Dispose(); // Should not throw
    }

    [Fact]
    public void Tracer_Start_FanOutToAllBackends()
    {
        var span1 = new TestSpan();
        var span2 = new TestSpan();
        Tracer.Add("a", _ => span1);
        Tracer.Add("b", _ => span2);

        using var emitter = Tracer.Start("myspan");
        emitter.Emit("key1", "value1");

        Assert.Contains("key1", span1.Emissions.Keys);
        Assert.Contains("key1", span2.Emissions.Keys);
    }

    [Fact]
    public void Tracer_Start_FailingBackend_DoesNotBlockOthers()
    {
        var goodSpan = new TestSpan();
        Tracer.Add("bad", _ => throw new Exception("Backend factory error"));
        Tracer.Add("good", _ => goodSpan);

        using var emitter = Tracer.Start("test");
        emitter.Emit("key", "value");

        Assert.Contains("key", goodSpan.Emissions.Keys);
    }

    [Fact]
    public void SpanEmitter_Dispose_DisposesAllBackends()
    {
        var span1 = new TestSpan();
        var span2 = new TestSpan();
        Tracer.Add("a", _ => span1);
        Tracer.Add("b", _ => span2);

        var emitter = Tracer.Start("test");
        emitter.Dispose();

        Assert.True(span1.Disposed);
        Assert.True(span2.Disposed);
    }

    [Fact]
    public void SpanEmitter_Emit_AfterDispose_IsNoOp()
    {
        var span = new TestSpan();
        Tracer.Add("test", _ => span);

        var emitter = Tracer.Start("test");
        emitter.Dispose();
        emitter.Emit("late", "data"); // Should not throw or add data

        Assert.DoesNotContain("late", span.Emissions.Keys);
    }

    // -----------------------------------------------------------------------
    // TraceSerializer — to_dict (§3.3)
    // -----------------------------------------------------------------------

    [Fact]
    public void ToDict_Primitives_Passthrough()
    {
        Assert.Null(TraceSerializer.ToDict(null));
        Assert.Equal("hello", TraceSerializer.ToDict("hello"));
        Assert.Equal(42, TraceSerializer.ToDict(42));
        Assert.Equal(3.14, TraceSerializer.ToDict(3.14));
        Assert.Equal(true, TraceSerializer.ToDict(true));
    }

    [Fact]
    public void ToDict_DateTime_IsoFormat()
    {
        var dt = new DateTime(2026, 4, 1, 12, 0, 0, DateTimeKind.Utc);
        var result = TraceSerializer.ToDict(dt) as string;
        Assert.NotNull(result);
        Assert.Contains("2026-04-01", result);
    }

    [Fact]
    public void ToDict_Exception_StructuredOutput()
    {
        var ex = new InvalidOperationException("test error");
        var result = TraceSerializer.ToDict(ex) as Dictionary<string, object?>;

        Assert.NotNull(result);
        Assert.Equal("InvalidOperationException", result["exception"]);
        Assert.Equal("test error", result["message"]);
    }

    [Fact]
    public void ToDict_Dict_RecursesValues()
    {
        var dict = new Dictionary<string, object?> { ["name"] = "Jane", ["age"] = 30 };
        var result = TraceSerializer.ToDict(dict) as Dictionary<string, object?>;

        Assert.NotNull(result);
        Assert.Equal("Jane", result["name"]);
        Assert.Equal(30, result["age"]);
    }

    // -----------------------------------------------------------------------
    // TraceSerializer — Redaction (§3.4)
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("api_key")]
    [InlineData("apiKey")]
    [InlineData("secret")]
    [InlineData("password")]
    [InlineData("auth_token")]
    [InlineData("credential")]
    [InlineData("cookie")]
    [InlineData("my_secret_value")]
    public void IsSensitiveKey_DetectsSensitiveKeys(string key)
    {
        Assert.True(TraceSerializer.IsSensitiveKey(key));
    }

    [Theory]
    [InlineData("name")]
    [InlineData("key")] // "key" alone is NOT sensitive per spec
    [InlineData("model")]
    [InlineData("temperature")]
    public void IsSensitiveKey_AllowsSafeKeys(string key)
    {
        Assert.False(TraceSerializer.IsSensitiveKey(key));
    }

    [Fact]
    public void ToDict_RedactsSensitiveKeys()
    {
        var dict = new Dictionary<string, object?>
        {
            ["name"] = "Jane",
            ["api_key"] = "sk-secret-123",
            ["password"] = "hunter2",
        };

        var result = TraceSerializer.ToDict(dict) as Dictionary<string, object?>;

        Assert.NotNull(result);
        Assert.Equal("Jane", result["name"]);
        Assert.Equal("[REDACTED]", result["api_key"]);
        Assert.Equal("[REDACTED]", result["password"]);
    }

    [Fact]
    public void ToDict_RedactsNestedSensitiveKeys()
    {
        var dict = new Dictionary<string, object?>
        {
            ["config"] = new Dictionary<string, object?>
            {
                ["endpoint"] = "https://example.com",
                ["apiKey"] = "secret-key",
            },
        };

        var result = TraceSerializer.ToDict(dict) as Dictionary<string, object?>;
        Assert.NotNull(result);

        var config = result["config"] as Dictionary<string, object?>;
        Assert.NotNull(config);
        Assert.Equal("https://example.com", config["endpoint"]);
        Assert.Equal("[REDACTED]", config["apiKey"]);
    }

    // -----------------------------------------------------------------------
    // Trace.TraceAsync
    // -----------------------------------------------------------------------

    [Fact]
    public async Task TraceAsync_NoBackends_StillExecutes()
    {
        var result = await Trace.TraceAsync<string>("test", async (emit) =>
        {
            return "hello";
        });

        Assert.Equal("hello", result);
    }

    [Fact]
    public async Task TraceAsync_EmitsSignatureAndResult()
    {
        var span = new TestSpan();
        Tracer.Add("test", _ => span);

        var result = await Trace.TraceAsync<string>("MyFunction", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["x"] = 42 });
            return "answer";
        });

        Assert.Equal("answer", result);
        Assert.Equal("MyFunction", span.Emissions["signature"]);
        Assert.NotNull(span.Emissions["result"]);
    }

    [Fact]
    public async Task TraceAsync_CapturesException()
    {
        var span = new TestSpan();
        Tracer.Add("test", _ => span);

        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await Trace.TraceAsync<string>("Failing", async (emit) =>
            {
                throw new InvalidOperationException("boom");
            });
        });

        Assert.True(span.Disposed);
        var errorResult = span.Emissions["result"] as Dictionary<string, object?>;
        Assert.NotNull(errorResult);
        Assert.Equal("InvalidOperationException", errorResult["exception"]);
    }

    // -----------------------------------------------------------------------
    // Trace.Wrap
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Wrap_NoBackends_ExecutesDirectly()
    {
        var wrapped = Trace.Wrap<string>("test", async () => "direct");
        var result = await wrapped();
        Assert.Equal("direct", result);
    }

    [Fact]
    public async Task Wrap_WithBackend_EmitsData()
    {
        var span = new TestSpan();
        Tracer.Add("test", _ => span);

        var wrapped = Trace.Wrap<string>("MyFunc", async () => "wrapped-result");
        var result = await wrapped();

        Assert.Equal("wrapped-result", result);
        Assert.Equal("MyFunc", span.Emissions["signature"]);
        Assert.True(span.Disposed);
    }

    [Fact]
    public async Task Wrap_OneArg_CapturesInput()
    {
        var span = new TestSpan();
        Tracer.Add("test", _ => span);

        var wrapped = Trace.Wrap<string, string>("Greet", async (name) => $"Hello {name}", "name");
        var result = await wrapped("World");

        Assert.Equal("Hello World", result);
        var inputs = span.Emissions["inputs"] as Dictionary<string, object?>;
        Assert.NotNull(inputs);
        Assert.Equal("World", inputs["name"]);
    }

    [Fact]
    public async Task Wrap_TwoArgs_CapturesInputs()
    {
        var span = new TestSpan();
        Tracer.Add("test", _ => span);

        var wrapped = Trace.Wrap<int, int, int>("Add", async (a, b) => a + b, "a", "b");
        var result = await wrapped(3, 4);

        Assert.Equal(7, result);
    }

    // -----------------------------------------------------------------------
    // PromptyTracer — frame accumulation
    // -----------------------------------------------------------------------

    [Fact]
    public void PromptyTracer_PushPop_CreatesFrame()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        try
        {
            var tracer = new PromptyTracer(tempDir);

            var frame = tracer.PushFrame("test-span");
            Assert.Equal("test-span", frame.Name);

            var popped = tracer.PopFrame();
            Assert.NotNull(popped);
            Assert.Equal("test-span", popped.Name);

            // Root span should write a .tracy file
            Assert.True(Directory.Exists(tempDir));
            var files = Directory.GetFiles(tempDir, "*.tracy");
            Assert.Single(files);
        }
        finally
        {
            if (Directory.Exists(tempDir))
                Directory.Delete(tempDir, true);
        }
    }

    [Fact]
    public void PromptyTracer_NestedSpans_CreateTree()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        try
        {
            var tracer = new PromptyTracer(tempDir);

            // Open root
            tracer.PushFrame("root");

            // Open child
            tracer.PushFrame("child");
            tracer.PopFrame(); // Close child → attaches to root.__frames

            // Open second child
            tracer.PushFrame("child2");
            tracer.PopFrame(); // Close child2

            var root = tracer.PopFrame(); // Close root → writes file
            Assert.NotNull(root);
            Assert.Equal(2, root.Children.Count);
            Assert.Equal("child", root.Children[0].Name);
            Assert.Equal("child2", root.Children[1].Name);
        }
        finally
        {
            if (Directory.Exists(tempDir))
                Directory.Delete(tempDir, true);
        }
    }

    [Fact]
    public void PromptyTracer_TracyFile_HasCorrectEnvelope()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        try
        {
            var tracer = new PromptyTracer(tempDir);

            // Use PushFrame/PopFrame directly instead of global Tracer to avoid cross-assembly interference
            var frame = tracer.PushFrame("test-span");
            frame.Data["signature"] = "MyModule.MyFunc";
            frame.Data["inputs"] = new Dictionary<string, object?> { ["x"] = 1 };
            frame.Data["result"] = "hello";
            tracer.PopFrame(); // Root frame → writes .tracy file

            var files = Directory.GetFiles(tempDir, "*.tracy");
            Assert.Single(files);

            var json = File.ReadAllText(files[0]);
            Assert.Contains("\"runtime\"", json);
            Assert.Contains("\"csharp\"", json);
            Assert.Contains("\"version\"", json);
            Assert.Contains("\"trace\"", json);
            Assert.Contains("\"__time\"", json);
            Assert.Contains("\"__frames\"", json);
            Assert.Contains("test-span", json);
        }
        finally
        {
            if (Directory.Exists(tempDir))
                Directory.Delete(tempDir, true);
        }
    }

    [Fact]
    public void PromptyTracer_UsageHoisting()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        try
        {
            var tracer = new PromptyTracer(tempDir);

            tracer.PushFrame("root");

            // Child span with usage in result
            var child = tracer.PushFrame("llm-call");
            child.Data["result"] = new Dictionary<string, object?>
            {
                ["content"] = "Hello",
                ["usage"] = new Dictionary<string, object?>
                {
                    ["prompt_tokens"] = 10L,
                    ["completion_tokens"] = 5L,
                    ["total_tokens"] = 15L,
                },
            };
            tracer.PopFrame();

            var root = tracer.PopFrame();
            Assert.NotNull(root);

            // Usage should be hoisted to root
            Assert.Equal(10, root.Usage.PromptTokens);
            Assert.Equal(5, root.Usage.CompletionTokens);
            Assert.Equal(15, root.Usage.TotalTokens);
        }
        finally
        {
            if (Directory.Exists(tempDir))
                Directory.Delete(tempDir, true);
        }
    }

    [Fact]
    public void FrameToDict_ProducesCorrectStructure()
    {
        var frame = new SpanFrame("test")
        {
            EndTime = DateTime.UtcNow,
        };
        frame.Data["signature"] = "MyModule.MyFunc";
        frame.Data["inputs"] = new Dictionary<string, object?> { ["x"] = 1 };
        frame.Data["result"] = "hello";

        var dict = PromptyTracer.FrameToDict(frame);

        Assert.Equal("test", dict["name"]);
        Assert.NotNull(dict["__time"]);
        Assert.NotNull(dict["__frames"]);
        Assert.Equal("MyModule.MyFunc", dict["signature"]);
    }

    // -----------------------------------------------------------------------
    // ConsoleTracer
    // -----------------------------------------------------------------------

    [Fact]
    public void ConsoleTracer_Register_AddsToRegistry()
    {
        ConsoleTracer.Register("console-test");
        Assert.True(Tracer.HasListeners);
    }

    // -----------------------------------------------------------------------
    // Pipeline integration — tracing is transparent
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Pipeline_WithTracing_StillWorks()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        try
        {
            // Register tracing
            var tracer = new PromptyTracer(tempDir);
            tracer.Register("test");

            // Register mock invokers
            InvokerRegistry.RegisterRenderer("jinja2", new PassthroughRenderer());
            InvokerRegistry.RegisterParser("prompty", new PassthroughParser());
            InvokerRegistry.RegisterExecutor("openai", new MockExecutor("Hello!"));
            InvokerRegistry.RegisterProcessor("openai", new MockProcessor());

            var agent = new Prompty
            {
                Name = "test-agent",
                Instructions = "Hello",
                Model = new Model { Id = "gpt-4", Provider = "openai" },
                Template = new Template
                {
                    Format = new FormatConfig { Kind = "jinja2" },
                    Parser = new ParserConfig { Kind = "prompty" },
                },
            };

            var result = await Pipeline.InvokeAsync(agent, raw: true);
            Assert.Equal("Hello!", result);

            // Should have generated .tracy files
            var files = Directory.GetFiles(tempDir, "*.tracy");
            Assert.True(files.Length > 0, "Expected .tracy files to be generated");
        }
        finally
        {
            Tracer.Clear();
            InvokerRegistry.Clear();
            if (Directory.Exists(tempDir))
                Directory.Delete(tempDir, true);
        }
    }

    // -----------------------------------------------------------------------
    // Test helpers
    // -----------------------------------------------------------------------

    private class TestSpan : ITracerSpan
    {
        public Dictionary<string, object?> Emissions { get; } = [];
        public bool Disposed { get; private set; }

        public void Emit(string key, object? value) => Emissions[key] = value;
        public void Dispose() => Disposed = true;
    }

    private class PassthroughRenderer : IRenderer
    {
        public Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs)
            => Task.FromResult(template);
    }

    private class PassthroughParser : IParser
    {
        public Task<List<Message>> ParseAsync(Prompty agent, string rendered, Dictionary<string, object?>? context)
            => Task.FromResult<List<Message>>([new() { Role = Roles.User, Parts = [new TextPart { Value = rendered }] }]);
    }

    private class MockExecutor(object response) : IExecutor
    {
        public Task<object> ExecuteAsync(Prompty agent, List<Message> messages)
            => Task.FromResult(response);

        public List<Message> FormatToolMessages(object rawResponse, List<ToolCall> toolCalls, List<string> toolResults, string? textContent = null)
        {
            var msgs = new List<Message> { new() { Role = Roles.Assistant, Parts = [] } };
            for (var i = 0; i < toolCalls.Count; i++)
                msgs.Add(new() { Role = Roles.Tool, Parts = [new TextPart { Value = toolResults[i] }] });
            return msgs;
        }
    }

    private class MockProcessor : IProcessor
    {
        public Task<object> ProcessAsync(Prompty agent, object response)
            => Task.FromResult(response);
    }

    // -----------------------------------------------------------------------
    // OTelTracer
    // -----------------------------------------------------------------------

    [Fact]
    public void OTelTracer_Register_AddsToRegistry()
    {
        OTelTracer.Register();
        Assert.True(Tracer.HasListeners);
    }

    [Fact]
    public void OTelTracer_CreateSpan_DoesNotThrow()
    {
        OTelTracer.Register("otel-test");

        using var emitter = Tracer.Start("TestSpan");
        emitter.Emit("signature", "test");
        emitter.Emit("inputs", new Dictionary<string, object?> { ["x"] = 42 });
        emitter.Emit("result", "done");
    }

    [Fact]
    public void OTelTracer_ErrorEmit_DoesNotThrow()
    {
        OTelTracer.Register("otel-error-test");

        using var emitter = Tracer.Start("ErrorSpan");
        emitter.Emit("error", new InvalidOperationException("test error"));
    }

    [Fact]
    public async Task OTelTracer_TraceAsync_Works()
    {
        OTelTracer.Register("otel-trace-test");

        var result = await Trace.TraceAsync<string>("OTelTest", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["q"] = "hello" });
            return "world";
        });

        Assert.Equal("world", result);
    }
}
