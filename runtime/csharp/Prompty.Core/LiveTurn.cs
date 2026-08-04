// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;

namespace Prompty.Core;

/// <summary>Runtime-only configuration for a public turn backed by the canonical <see cref="TurnEngine"/>.</summary>
public sealed class TurnEnginePipelineOptions
{
    public Dictionary<string, Func<string, Task<string>>>? Tools { get; init; }

    public bool Raw { get; init; }

    public EventCallback? OnEvent { get; init; }

    public int? ContextBudget { get; init; }

    public Guardrails? Guardrails { get; init; }

    public Steering? Steering { get; init; }

    public CompactionStrategy? Compaction { get; init; }

    public IEngineDurabilityPort? Durability { get; init; }

    public IEnginePermissionPort? Permission { get; init; }

    public IEnginePostCommitPort? PostCommit { get; init; }
}

/// <summary>Adapts the public pipeline registry and hooks to the canonical turn engine ports.</summary>
internal static class LiveTurn
{
    private static long _turnId;

    public static Task<object> RunAsync(
        Prompty agent,
        Dictionary<string, object?>? inputs,
        Dictionary<string, Func<string, Task<string>>>? tools,
        int maxIterations,
        bool raw,
        EventCallback? onEvent,
        CancellationToken cancellationToken,
        int? contextBudget,
        Guardrails? guardrails,
        Steering? steering,
        bool parallelToolCalls,
        int maxLlmRetries,
        CompactionStrategy? compaction)
    {
        if (parallelToolCalls)
        {
            throw new ArgumentException(
                "parallelToolCalls=true is not supported by the canonical engine; "
                + "tool effects execute sequentially for deterministic durable ordering.",
                nameof(parallelToolCalls));
        }

        var id = Interlocked.Increment(ref _turnId);
        var agentMode = (agent.Tools?.Count ?? 0) > 0 || (tools?.Count ?? 0) > 0
            || guardrails is not null || steering is not null || contextBudget is not null;
        var request = new TurnEngineRequest($"pipeline-session-{id}", $"pipeline-turn-{id}", [])
        {
            Inputs = inputs ?? new Dictionary<string, object?>(),
            MaxIterations = Math.Max(maxIterations, 1),
            MaxModelAttempts = agentMode ? Math.Max(maxLlmRetries, 1) : 1,
        };
        var options = new TurnEnginePipelineOptions
        {
            Tools = tools,
            Raw = raw,
            OnEvent = onEvent,
            ContextBudget = contextBudget,
            Guardrails = guardrails,
            Steering = steering,
            Compaction = compaction,
        };
        return RunAsync(agent, request, options, cancellationToken);
    }

    public static async Task<object> RunAsync(
        Prompty agent,
        TurnEngineRequest request,
        TurnEnginePipelineOptions? options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(agent);
        ArgumentNullException.ThrowIfNull(request);
        options ??= new TurnEnginePipelineOptions();
        var inputs = NormalizeInputs(request.Inputs);

        var provider = agent.Model?.Provider ?? "openai";
        var executor = InvokerRegistry.GetExecutor(provider);
        var processor = InvokerRegistry.GetProcessor(provider);
        var agentMode = (agent.Tools?.Count ?? 0) > 0 || (options.Tools?.Count ?? 0) > 0;
        var failures = new LiveFailureState();
        var authorization = new LivePermissionPort(options.Permission, options.Guardrails);
        var durability = new LiveDurabilityPort(
            options.Durability ?? new NoopDurabilityPort(),
            options.OnEvent,
            agent,
            agentMode,
            request.MaxIterations);
        var engine = new TurnEngine(new TurnEngineEffects
        {
            Model = new LiveModelPort(agent, executor, processor, options.Raw, agentMode, failures),
            Tools = new LiveToolPort(
                agent,
                options.Tools,
                inputs,
                authorization,
                options.OnEvent),
            Clock = new LiveClock(),
            Ids = new LiveIds(),
            Policy = new LivePolicyPort(
                agent,
                inputs,
                options.ContextBudget,
                options.Guardrails,
                options.Steering,
                options.Compaction,
                failures),
            Retry = new LiveRetryPort(options.OnEvent),
            Conversation = new LiveConversationPort(executor),
            Permission = authorization,
            Durability = durability,
            PostCommit = options.PostCommit ?? new NoopPostCommitPort(),
            Stream = new LiveStreamPort(options.OnEvent),
        });

        TurnEngineResult result;
        try
        {
            result = await engine.RunAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            durability.EmitUncommittedError();
            throw;
        }

        return result.Commit.Status switch
        {
            EngineTurnStatus.Success => result.Commit.Output!,
            EngineTurnStatus.Cancelled => throw new OperationCanceledException("Operation cancelled", cancellationToken),
            EngineTurnStatus.Failed or EngineTurnStatus.ReconciliationRequired =>
                throw MapFailure(result, request.MaxModelAttempts, agentMode, failures),
            _ => throw new InvalidOperationException($"Unsupported engine status '{result.Commit.Status}'."),
        };
    }

    private static Dictionary<string, object?>? NormalizeInputs(object? inputs)
    {
        return inputs switch
        {
            null => null,
            Dictionary<string, object?> values => values,
            IReadOnlyDictionary<string, object?> values => values.ToDictionary(),
            JsonElement { ValueKind: JsonValueKind.Object } value =>
                value.Deserialize<Dictionary<string, object?>>(),
            _ => throw new ArgumentException(
                "Turn engine inputs must be a string-keyed dictionary or JSON object.",
                nameof(inputs)),
        };
    }

    private static Exception MapFailure(
        TurnEngineResult result,
        int maxModelAttempts,
        bool agentMode,
        LiveFailureState failures)
    {
        var output = result.Commit.Output as IReadOnlyDictionary<string, object?>;
        var kind = output?.GetValueOrDefault("errorKind")?.ToString() ?? "engine_error";
        var message = output?.GetValueOrDefault("message")?.ToString() ?? "TurnEngine failed.";
        return kind switch
        {
            "input_guardrail_denied" or "output_guardrail_denied" => new GuardrailError(failures.GuardrailReason ?? message),
            "model_error" when !agentMode && failures.InvokerError is not null => failures.InvokerError,
            "model_error" => new ExecuteError(
                $"LLM call failed after {maxModelAttempts} retries: {message}",
                [.. result.Commit.Messages]),
            "max_iterations" => new InvalidOperationException(
                $"Agent loop exceeded maximum iterations ({result.Commit.Iterations})."),
            "prepare_error" when failures.InvokerError is not null => failures.InvokerError,
            _ => failures.InvokerError ?? new InvalidOperationException(message),
        };
    }

    private static object? MetadataValue(IDictionary<string, object>? metadata, string key)
        => metadata is not null && metadata.TryGetValue(key, out var value) ? value : null;

    private sealed class LiveFailureState
    {
        public Exception? InvokerError { get; set; }

        public string? GuardrailReason { get; set; }

        public bool SkipOutputGuardrail { get; set; }
    }

    private sealed class LiveModelPort(
        Prompty agent,
        IExecutor executor,
        IProcessor processor,
        bool raw,
        bool agentMode,
        LiveFailureState failures) : IEngineModelPort
    {
        public async Task<ModelInvocationResponse> InvokeAsync(
            ModelInvocationRequest request,
            CancellationToken cancellationToken,
            IEngineModelStreamPort stream)
        {
            cancellationToken.ThrowIfCancellationRequested();
            object rawResponse;
            try
            {
                rawResponse = await executor.ExecuteAsync(agent, [.. request.Context.Messages]).ConfigureAwait(false);
                if (rawResponse is PromptyStream rawStream)
                {
                    await foreach (var chunk in rawStream.WithCancellation(cancellationToken).ConfigureAwait(false))
                    {
                        if (chunk is string text && text.Length > 0)
                        {
                            await stream.EmitAsync(new ModelStreamChunk.Text(text)).ConfigureAwait(false);
                        }
                    }
                }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error)
            {
                failures.InvokerError = error;
                throw new PortError(error.Message);
            }

            object processed;
            try
            {
                failures.SkipOutputGuardrail = raw && !agentMode;
                processed = raw && !agentMode
                    ? rawResponse
                    : await processor.ProcessAsync(agent, rawResponse).ConfigureAwait(false);
            }
            catch (Exception error)
            {
                failures.InvokerError = error;
                throw new PortError(error.Message);
            }

            if (processed is ToolCallResult toolResult && toolResult.ToolCalls.Count > 0)
            {
                return new ModelInvocationResponse
                {
                    AssistantMessages = [],
                    ToolRequests = toolResult.ToolCalls.Select(call => new ModelToolRequest
                    {
                        Id = call.Id,
                        Name = call.Name,
                        Arguments = ParseArgumentsValue(call.Arguments),
                        Metadata = new Dictionary<string, object> { ["argumentsText"] = call.Arguments },
                    }).ToList(),
                    Metadata = new Dictionary<string, object>
                    {
                        ["rawResponse"] = rawResponse,
                        ["textContent"] = toolResult.Content ?? string.Empty,
                    },
                };
            }

            return new ModelInvocationResponse
            {
                Output = processed,
                AssistantMessages = [],
                ToolRequests = [],
                NextContextState = new InvocationContextState
                {
                    Portability = InvocationContextPortability.Portable,
                    DelegatedState = [],
                },
                Metadata = new Dictionary<string, object> { ["rawResponse"] = rawResponse },
            };
        }

        private static object ParseArgumentsValue(string arguments)
        {
            try
            {
                return JsonSerializer.Deserialize<object>(arguments) ?? arguments;
            }
            catch (JsonException)
            {
                return arguments;
            }
        }
    }

    private sealed class LiveConversationPort(IExecutor executor) : IEngineConversationPort
    {
        public IList<Message> FormatToolExchange(
            ModelInvocationResponse response,
            IReadOnlyList<ModelToolResult> results)
        {
            var requests = response.ToolRequests ?? [];
            var calls = requests.Select(request => new ToolCall
            {
                Id = request.Id,
                Name = request.Name,
                Arguments = MetadataValue(request.Metadata, "argumentsText")?.ToString()
                    ?? request.ModelArgumentsText(),
            }).ToList();
            var orderedResults = requests.Select(request =>
                results.First(result => result.RequestId == request.Id).ModelText()).ToList();
            var rawResponse = MetadataValue(response.Metadata, "rawResponse")
                ?? throw PortError.Configuration("provider response metadata is missing rawResponse");
            var content = MetadataValue(response.Metadata, "textContent")?.ToString();
            try
            {
                return executor.FormatToolMessages(rawResponse, calls, orderedResults, content);
            }
            catch (Exception error)
            {
                throw PortError.Configuration(error.Message);
            }
        }
    }

    private sealed class LiveToolPort(
        Prompty agent,
        Dictionary<string, Func<string, Task<string>>>? tools,
        Dictionary<string, object?>? inputs,
        LivePermissionPort authorization,
        EventCallback? onEvent) : IEngineToolPort
    {
        public async Task<ModelToolResult> ExecuteAsync(ModelToolRequest request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var call = new ToolCall
            {
                Id = request.Id,
                Name = request.Name,
                Arguments = MetadataValue(request.Metadata, "argumentsText")?.ToString()
                    ?? request.ModelArgumentsText(),
            };
            if (authorization.TakeRewrite(request.Id) is { } rewritten)
            {
                call.Arguments = JsonSerializer.Serialize(rewritten);
            }

            string output;
            try
            {
                output = await ToolDispatch.DispatchAsync(agent, call, tools, inputs).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error)
            {
                AgentEvents.EmitEvent(onEvent, AgentEventType.Error, new Dictionary<string, object?>
                {
                    ["tool"] = request.Name,
                    ["error"] = error.Message,
                });
                output = $"Error: Tool '{request.Name}' failed: {error.Message}";
            }
            var failed = output.StartsWith("Error:", StringComparison.Ordinal);
            return new ModelToolResult
            {
                RequestId = request.Id,
                Name = request.Name,
                Outcome = failed ? ModelToolOutcome.Failed : ModelToolOutcome.Success,
                Output = output,
                ErrorKind = failed ? "tool_error" : null,
            };
        }
    }

    private sealed class LivePermissionPort(
        IEnginePermissionPort? inner,
        Guardrails? guardrails) : IEnginePermissionPort
    {
        private readonly Dictionary<string, Dictionary<string, object?>> _rewrites = [];

        public async Task<EnginePermissionDecision> AuthorizeAsync(
            ModelToolRequest request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (inner is not null)
            {
                var decision = await inner.AuthorizeAsync(request, cancellationToken).ConfigureAwait(false);
                if (!decision.Approved)
                {
                    return decision;
                }
            }
            if (guardrails is null)
            {
                return new EnginePermissionDecision { Approved = true };
            }

            var arguments = ToolDispatch.ParseArguments(request.ModelArgumentsText());
            var result = guardrails.CheckTool(request.Name, arguments);
            if (!result.Allowed)
            {
                return new EnginePermissionDecision
                {
                    Approved = false,
                    Reason = $"Error: Tool guardrail denied: {result.Reason ?? "Tool denied"}",
                };
            }
            if (result.Rewrite is Dictionary<string, object?> rewrite)
            {
                _rewrites[request.Id] = rewrite;
            }
            return new EnginePermissionDecision { Approved = true };
        }

        public Dictionary<string, object?>? TakeRewrite(string requestId)
            => _rewrites.Remove(requestId, out var rewrite) ? rewrite : null;
    }

    private sealed class LivePolicyPort(
        Prompty agent,
        Dictionary<string, object?>? inputs,
        int? contextBudget,
        Guardrails? guardrails,
        Steering? steering,
        CompactionStrategy? compaction,
        LiveFailureState failures) : IEngineHostPolicyPort
    {
        private bool _prepared;

        public async Task<HostPolicyResult> BeforeModelAsync(
            HostPolicyRequest request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var messages = request.Messages.ToList();
            var stablePrefix = Math.Min(request.StablePrefixMessages, messages.Count);
            if (!_prepared)
            {
                try
                {
                    messages = await Pipeline.PrepareAsync(agent, inputs).ConfigureAwait(false);
                }
                catch (Exception error)
                {
                    failures.InvokerError = error;
                    throw new HostPolicyException("prepare_error", error.Message);
                }
                stablePrefix = messages.Count;
                _prepared = true;
            }

            var steeringMessages = steering?.Drain() ?? [];
            messages.AddRange(steeringMessages);
            var trimmed = 0;
            if (contextBudget is not null)
            {
                var before = messages.ToList();
                var (droppedCount, droppedMessages) = ContextWindow.TrimToContextWindow(messages, contextBudget.Value);
                trimmed = droppedCount;
                if (droppedCount > 0 && compaction is not null)
                {
                    await Pipeline.ApplyCompactionAsync(compaction, droppedMessages, messages, onEvent: null).ConfigureAwait(false);
                }
                stablePrefix = Math.Min(stablePrefix, CommonPrefixLength(before, messages));
            }

            if (guardrails is not null)
            {
                var check = guardrails.CheckInput(messages);
                if (!check.Allowed)
                {
                    failures.GuardrailReason = check.Reason;
                    throw new HostPolicyException("input_guardrail_denied", check.Reason ?? "Input guardrail denied");
                }
                if (check.Rewrite is List<Message> rewritten)
                {
                    messages = rewritten;
                    stablePrefix = Math.Min(stablePrefix, messages.Count);
                }
            }

            return new HostPolicyResult
            {
                Messages = messages,
                StablePrefixMessages = stablePrefix,
                Metadata = new Dictionary<string, object>
                {
                    ["steeringCount"] = steeringMessages.Count,
                    ["trimmedCount"] = trimmed,
                    ["notifyMessagesUpdated"] = steeringMessages.Count > 0 || trimmed > 0,
                },
            };
        }

        public Task<FinalOutputPolicyResult> BeforeCommitAsync(
            FinalOutputPolicyRequest request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var output = request.Output;
            if (guardrails is not null && !failures.SkipOutputGuardrail)
            {
                var message = output switch
                {
                    Message existing => existing,
                    string text => Message.Assistant(text),
                    _ => Message.Assistant(output?.ToString() ?? string.Empty),
                };
                var check = guardrails.CheckOutput(message);
                if (!check.Allowed)
                {
                    failures.GuardrailReason = check.Reason;
                    throw new HostPolicyException("output_guardrail_denied", check.Reason ?? "Output guardrail denied");
                }
                if (check.Rewrite is not null)
                {
                    output = check.Rewrite;
                }
            }
            return Task.FromResult(new FinalOutputPolicyResult { Output = output });
        }

        private static int CommonPrefixLength(IList<Message> left, IList<Message> right)
        {
            var length = Math.Min(left.Count, right.Count);
            var common = 0;
            while (common < length && left[common].ToJson(indent: false) == right[common].ToJson(indent: false))
            {
                common++;
            }
            return common;
        }
    }

    private sealed class LiveRetryPort(EventCallback? onEvent) : IEngineRetryPolicyPort
    {
        public async Task BackoffAsync(RetryPolicyRequest request, CancellationToken cancellationToken)
        {
            AgentEvents.EmitEvent(onEvent, AgentEventType.Status, new Dictionary<string, object?>
            {
                ["message"] = $"LLM call failed, retrying (attempt {request.NextAttempt}/{request.MaxAttempts})...",
            });
            AgentEvents.EmitEvent(onEvent, AgentEventType.Retry, new Dictionary<string, object?>
            {
                ["operation"] = "llm",
                ["attempt"] = request.NextAttempt,
                ["maxAttempts"] = request.MaxAttempts,
            });
            var delay = Math.Min(Math.Pow(2, request.FailedAttempts) + Random.Shared.NextDouble(), 60);
            await Task.Delay(TimeSpan.FromSeconds(delay), cancellationToken)
                .ConfigureAwait(false);
        }
    }

    private sealed class LiveStreamPort(EventCallback? onEvent) : IEngineModelStreamPort
    {
        public Task EmitAsync(ModelStreamChunk chunk)
        {
            if (chunk is ModelStreamChunk.Text text)
            {
                AgentEvents.EmitEvent(onEvent, AgentEventType.Token, new Dictionary<string, object?> { ["token"] = text.Value });
            }
            else if (chunk is ModelStreamChunk.Thinking thinking)
            {
                AgentEvents.EmitEvent(onEvent, AgentEventType.Thinking, new Dictionary<string, object?> { ["thinking"] = thinking.Value });
            }
            return Task.CompletedTask;
        }
    }

    private sealed class LiveDurabilityPort(
        IEngineDurabilityPort inner,
        EventCallback? onEvent,
        Prompty agent,
        bool agentMode,
        int maxIterations) : IEngineDurabilityPort
    {
        private IList<Message> _messages = [];
        private int _iterations;
        private bool _terminal;

        public async Task AppendAsync(EngineEvent @event)
        {
            await inner.AppendAsync(@event).ConfigureAwait(false);
            Project(@event);
        }

        public async Task AppendWithCheckpointAsync(
            IReadOnlyList<EngineEvent> events,
            EngineCheckpoint checkpoint)
        {
            await inner.AppendWithCheckpointAsync(events, checkpoint).ConfigureAwait(false);
            _messages = checkpoint.Messages;
            _iterations = checkpoint.CompletedModelIterations;
            foreach (var @event in events)
            {
                Project(@event);
            }
        }

        public void EmitUncommittedError() => EmitTerminal("error", null);

        private void Project(EngineEvent @event)
        {
            var payload = @event.Payload as IReadOnlyDictionary<string, object?>;
            switch (@event.Kind)
            {
                case EngineEventKind.TurnStarted:
                    AgentEvents.EmitEvent(onEvent, AgentEventType.TurnStart, new Dictionary<string, object?>
                    {
                        ["agent"] = agent.Name,
                        ["maxIterations"] = maxIterations,
                    });
                    break;
                case EngineEventKind.ModelInvocationStarted:
                    AgentEvents.EmitEvent(onEvent, AgentEventType.LlmStart, new Dictionary<string, object?>
                    {
                        ["provider"] = agent.Model?.Provider,
                        ["modelId"] = agent.Model?.Id,
                        ["messageCount"] = payload?.GetValueOrDefault("messageCount"),
                        ["attempt"] = payload?.GetValueOrDefault("attempt"),
                        ["iteration"] = @event.Iteration,
                    });
                    break;
                case EngineEventKind.ModelInvocationCompleted:
                case EngineEventKind.ModelInvocationReconciled:
                    AgentEvents.EmitEvent(onEvent, AgentEventType.LlmComplete, new Dictionary<string, object?>
                    {
                        ["iteration"] = @event.Iteration,
                    });
                    break;
                case EngineEventKind.PermissionRequested:
                    AgentEvents.EmitEvent(onEvent, AgentEventType.PermissionRequested, new Dictionary<string, object?>
                    {
                        ["iteration"] = @event.Iteration,
                        ["request"] = payload?.GetValueOrDefault("toolRequest"),
                    });
                    break;
                case EngineEventKind.PermissionResolved:
                    AgentEvents.EmitEvent(onEvent, AgentEventType.PermissionCompleted, new Dictionary<string, object?>
                    {
                        ["iteration"] = @event.Iteration,
                        ["decision"] = payload?.GetValueOrDefault("decision"),
                    });
                    break;
                case EngineEventKind.ToolExecutionStarted:
                    if (payload?.GetValueOrDefault("toolRequest") is ModelToolRequest request)
                    {
                        AgentEvents.EmitEvent(onEvent, AgentEventType.ToolCallStart, new Dictionary<string, object?>
                        {
                            ["tool"] = request.Name,
                            ["arguments"] = request.ModelArgumentsText(),
                        });
                    }
                    break;
                case EngineEventKind.ToolExecutionCompleted:
                    if (payload?.GetValueOrDefault("toolResult") is ModelToolResult result)
                    {
                        AgentEvents.EmitEvent(onEvent, AgentEventType.ToolResult, new Dictionary<string, object?>
                        {
                            ["tool"] = result.Name,
                            ["result"] = result.ModelText(),
                        });
                        AgentEvents.EmitEvent(onEvent, AgentEventType.ToolCallComplete, new Dictionary<string, object?>
                        {
                            ["name"] = result.Name,
                            ["success"] = result.Outcome == ModelToolOutcome.Success,
                            ["result"] = result.ModelText(),
                            ["errorKind"] = result.ErrorKind,
                        });
                    }
                    break;
                case EngineEventKind.ConversationUpdated:
                    AgentEvents.EmitEvent(onEvent, AgentEventType.MessagesUpdated, new Dictionary<string, object?>
                    {
                        ["messages"] = _messages,
                    });
                    break;
                case EngineEventKind.TurnCommitted:
                    AgentEvents.EmitEvent(onEvent, AgentEventType.Done, new Dictionary<string, object?>
                    {
                        ["iterations"] = _iterations,
                    });
                    EmitTerminal("success", payload?.GetValueOrDefault("output"));
                    break;
                case EngineEventKind.TurnCancelled:
                    AgentEvents.EmitEvent(onEvent, AgentEventType.Cancelled, new Dictionary<string, object?>());
                    EmitTerminal("cancelled", null);
                    break;
                case EngineEventKind.TurnFailed:
                case EngineEventKind.TurnReconciliationRequired:
                    EmitTerminal("error", null);
                    break;
            }
        }

        private void EmitTerminal(string status, object? response)
        {
            if (_terminal)
            {
                return;
            }
            _terminal = true;
            AgentEvents.EmitEvent(onEvent, AgentEventType.TurnEnd, new Dictionary<string, object?>
            {
                ["iterations"] = agentMode ? _iterations : 0,
                ["status"] = status,
                ["response"] = response,
            });
        }
    }

    private sealed class LiveClock : IEngineClock
    {
        public string Now() => DateTimeOffset.UtcNow.ToString("O");
    }

    private sealed class LiveIds : IEngineIdGenerator
    {
        private long _id;

        public string NextId(string kind) => $"{kind}-{Interlocked.Increment(ref _id)}";
    }
}

internal static class LiveTurnModelExtensions
{
    public static string ModelArgumentsText(this ModelToolRequest request) => request.Arguments switch
    {
        null => string.Empty,
        string text => text,
        var value => JsonSerializer.Serialize(value),
    };
}
