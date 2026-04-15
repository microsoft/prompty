// Copyright (c) Microsoft. All rights reserved.

using System.Text.RegularExpressions;

namespace Prompty.Core;

/// <summary>
/// Delegate type for tool handlers that execute tools by kind.
/// Receives the agent, tool definition, and parsed arguments.
/// Returns the tool result as a string.
/// </summary>
public delegate Task<string> ToolHandler(Prompty agent, Tool tool, Dictionary<string, object?> arguments);

/// <summary>
/// Exception thrown when no handler is registered for a tool kind.
/// </summary>
public class ToolHandlerError : InvalidOperationException
{
    public ToolHandlerError(string message) : base(message) { }
}

/// <summary>
/// Two-layer tool dispatch system matching the Prompty spec (§11.2).
///
/// Layer 1: Name-based registry — per-tool callable overrides.
/// Layer 2: Kind-based handler registry — fallback handlers by tool kind.
///
/// Dispatch order:
///   1. Per-call user tools (passed to dispatch)
///   2. Global name registry (register_tool)
///   3. Kind handler from agent.tools definition (register_tool_handler)
///   4. Wildcard "*" handler (catch-all)
///   5. Error if nothing matches
/// </summary>
public static class ToolDispatch
{
    // Layer 1: Name → callable
    private static readonly Dictionary<string, Func<string, Task<string>>> _nameRegistry = [];

    // Layer 2: Kind → handler
    private static readonly Dictionary<string, ToolHandler> _kindHandlers = [];

    private static readonly Lock _lock = new();

    // -----------------------------------------------------------------------
    // Layer 1: Name-based registry
    // -----------------------------------------------------------------------

    /// <summary>Register a tool callable by name.</summary>
    public static void RegisterTool(string name, Func<string, Task<string>> handler)
    {
        lock (_lock) { _nameRegistry[name] = handler; }
    }

    /// <summary>Get a tool callable by name, or null if not registered.</summary>
    public static Func<string, Task<string>>? GetTool(string name)
    {
        lock (_lock) { return _nameRegistry.GetValueOrDefault(name); }
    }

    /// <summary>Clear all name-based tool registrations.</summary>
    public static void ClearTools()
    {
        lock (_lock) { _nameRegistry.Clear(); }
    }

    // -----------------------------------------------------------------------
    // Layer 2: Kind-based handler registry
    // -----------------------------------------------------------------------

    /// <summary>Register a tool handler by kind.</summary>
    public static void RegisterToolHandler(string kind, ToolHandler handler)
    {
        lock (_lock) { _kindHandlers[kind] = handler; }
    }

    /// <summary>Get a tool handler by kind.</summary>
    public static ToolHandler? GetToolHandler(string kind)
    {
        lock (_lock) { return _kindHandlers.GetValueOrDefault(kind); }
    }

    /// <summary>Clear all kind-based handler registrations.</summary>
    public static void ClearToolHandlers()
    {
        lock (_lock) { _kindHandlers.Clear(); }
    }

    // -----------------------------------------------------------------------
    // Built-in handlers
    // -----------------------------------------------------------------------

    /// <summary>
    /// Register the built-in "function" kind handler.
    /// Called automatically on first use.
    /// </summary>
    public static void RegisterBuiltins()
    {
        RegisterToolHandler("function", FunctionToolHandler);
        RegisterToolHandler("prompty", PromptyToolHandler);
        RegisterToolHandler("mcp", McpToolHandler);
        RegisterToolHandler("openapi", OpenApiToolHandler);
    }

    /// <summary>
    /// Built-in handler for kind="function".
    /// Function tools require a callable registered in the name registry.
    /// </summary>
    private static Task<string> FunctionToolHandler(Prompty agent, Tool tool, Dictionary<string, object?> arguments)
    {
        // Function tools are dispatched via name registry — if we reach the kind handler,
        // it means no callable was registered for this function name.
        throw new ToolHandlerError(
            $"Function tool '{tool.Name}' has no registered callable. " +
            "Register it via ToolDispatch.RegisterTool() or pass it as a user tool.");
    }

    /// <summary>
    /// Built-in handler for kind="prompty".
    /// Loads and executes a child .prompty file as a tool.
    /// </summary>
    private static async Task<string> PromptyToolHandler(Prompty agent, Tool tool, Dictionary<string, object?> arguments)
    {
        if (tool is not PromptyTool promptyTool || string.IsNullOrEmpty(promptyTool.Path))
            throw new ToolHandlerError($"Prompty tool '{tool.Name}' has no path.");

        // Resolve path relative to the parent agent's source
        var parentDir = agent.Metadata?.TryGetValue("__source_path", out var sp) == true && sp is string srcPath
            ? System.IO.Path.GetDirectoryName(srcPath)
            : Directory.GetCurrentDirectory();
        var childPath = System.IO.Path.Combine(parentDir ?? ".", promptyTool.Path);
        var childAgent = PromptyLoader.Load(childPath);

        // Execute as single-shot by default
        var result = await Pipeline.InvokeAsync(childAgent, arguments);
        return result?.ToString() ?? "";
    }

    /// <summary>
    /// Built-in handler for kind="mcp".
    /// MCP tool execution requires an external MCP server connection, which is not yet implemented.
    /// </summary>
    private static Task<string> McpToolHandler(Prompty agent, Tool tool, Dictionary<string, object?> arguments)
    {
        throw new ToolHandlerError(
            $"MCP tool '{tool.Name}' cannot be executed in-process. " +
            "MCP tool execution requires an external MCP server connection, which is not yet implemented.");
    }

    /// <summary>
    /// Built-in handler for kind="openapi".
    /// OpenAPI tool execution requires parsing an OpenAPI specification and making HTTP calls, which is not yet implemented.
    /// </summary>
    private static Task<string> OpenApiToolHandler(Prompty agent, Tool tool, Dictionary<string, object?> arguments)
    {
        throw new ToolHandlerError(
            $"OpenAPI tool '{tool.Name}' cannot be executed in-process. " +
            "OpenAPI tool execution requires parsing the specification and making HTTP calls, which is not yet implemented.");
    }

    // -----------------------------------------------------------------------
    // Dispatch
    // -----------------------------------------------------------------------

    /// <summary>
    /// Dispatch a single tool call. Resolves the handler using the spec's dispatch order:
    /// user_tools → name registry → kind handler (from agent.tools) → wildcard → error.
    /// </summary>
    /// <param name="agent">The parent agent (for tool definitions and context).</param>
    /// <param name="call">The tool call from the LLM.</param>
    /// <param name="userTools">Per-call tool overrides (highest priority).</param>
    public static async Task<string> DispatchAsync(
        Prompty agent,
        ToolCall call,
        Dictionary<string, Func<string, Task<string>>>? userTools = null)
    {
        var arguments = ParseArguments(call.Arguments);

        // If all parse strategies failed, return error to LLM (§9.8)
        if (arguments.ContainsKey("_error"))
        {
            return $"Error: Invalid JSON in tool arguments for '{call.Name}': {arguments["_error"]}";
        }

        // Apply bindings from the tool definition
        var toolDef = FindToolDefinition(agent, call.Name);
        if (toolDef?.Bindings is not null)
        {
            foreach (var binding in toolDef.Bindings)
            {
                if (!string.IsNullOrEmpty(binding.Name) && !string.IsNullOrEmpty(binding.Input))
                {
                    arguments[binding.Name] = binding.Input;
                }
            }
        }

        // 1. Per-call user tools
        if (userTools is not null && userTools.TryGetValue(call.Name, out var userFn))
        {
            return await userFn(call.Arguments);
        }

        // 2. Global name registry
        var registeredFn = GetTool(call.Name);
        if (registeredFn is not null)
        {
            return await registeredFn(call.Arguments);
        }

        // 3. Kind handler (look up tool definition to get kind)
        if (toolDef is not null)
        {
            var kind = toolDef.Kind ?? "function";
            var handler = GetToolHandler(kind);
            if (handler is not null)
            {
                return await handler(agent, toolDef, arguments);
            }

            // 4. Wildcard handler
            var wildcardHandler = GetToolHandler("*");
            if (wildcardHandler is not null)
            {
                return await wildcardHandler(agent, toolDef, arguments);
            }
        }

        // 5. Error
        throw new ToolHandlerError(
            $"No handler registered for tool '{call.Name}'. " +
            "Register it via ToolDispatch.RegisterTool() or pass it as a user tool.");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// <summary>
    /// Find the tool definition in the agent's tools list by name.
    /// </summary>
    private static Tool? FindToolDefinition(Prompty agent, string toolName)
    {
        if (agent.Tools is null) return null;
        return agent.Tools.FirstOrDefault(t =>
            string.Equals(t.Name, toolName, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Parse tool arguments JSON with fallback strategies per spec §9.8.
    /// Strategy order: direct parse → strip markdown fences → extract JSON block → strip trailing commas.
    /// </summary>
    public static Dictionary<string, object?> ParseArguments(string arguments)
    {
        if (string.IsNullOrWhiteSpace(arguments))
            return [];

        // Strategy 1: Direct parse
        var direct = TryParseJson(arguments);
        if (direct is not null) return direct;

        // Strategy 2: Strip markdown code fences
        var fenceMatch = Regex.Match(arguments, @"^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$");
        if (fenceMatch.Success)
        {
            var stripped = fenceMatch.Groups[1].Value;
            var fenced = TryParseJson(stripped);
            if (fenced is not null)
            {
                Console.Error.WriteLine("[prompty] Parsed tool arguments after stripping markdown fences");
                return fenced;
            }
        }

        // Strategy 3: Extract first balanced JSON block
        var block = ExtractFirstJsonBlock(arguments);
        if (block is not null)
        {
            var extracted = TryParseJson(block);
            if (extracted is not null)
            {
                Console.Error.WriteLine("[prompty] Parsed tool arguments after extracting JSON block");
                return extracted;
            }
        }

        // Strategy 4: Strip trailing commas before } or ]
        var cleaned = Regex.Replace(arguments, @",\s*([}\]])", "$1");
        if (cleaned != arguments)
        {
            var trailingFixed = TryParseJson(cleaned);
            if (trailingFixed is not null)
            {
                Console.Error.WriteLine("[prompty] Parsed tool arguments after stripping trailing commas");
                return trailingFixed;
            }
        }

        // All strategies failed — return error marker (NOT silent empty dict)
        return new Dictionary<string, object?> { ["_error"] = "All JSON parse strategies failed for tool arguments" };
    }

    /// <summary>
    /// Extract the first balanced {...} block from text, respecting string escapes.
    /// </summary>
    internal static string? ExtractFirstJsonBlock(string text)
    {
        var start = text.IndexOf('{');
        if (start == -1) return null;

        var depth = 0;
        var inString = false;
        var escapeNext = false;

        for (var i = start; i < text.Length; i++)
        {
            var ch = text[i];
            if (escapeNext)
            {
                escapeNext = false;
                continue;
            }
            if (inString)
            {
                if (ch == '\\') escapeNext = true;
                else if (ch == '"') inString = false;
                continue;
            }
            switch (ch)
            {
                case '"': inString = true; break;
                case '{': depth++; break;
                case '}':
                    depth--;
                    if (depth == 0) return text[start..(i + 1)];
                    break;
            }
        }
        return null;
    }

    /// <summary>
    /// Try to parse a JSON string into a dictionary. Returns null on failure.
    /// </summary>
    private static Dictionary<string, object?>? TryParseJson(string json)
    {
        try
        {
            var doc = System.Text.Json.JsonDocument.Parse(json);
            var result = new Dictionary<string, object?>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                result[prop.Name] = prop.Value.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.String => prop.Value.GetString(),
                    System.Text.Json.JsonValueKind.Number => prop.Value.GetDouble(),
                    System.Text.Json.JsonValueKind.True => true,
                    System.Text.Json.JsonValueKind.False => false,
                    System.Text.Json.JsonValueKind.Null => null,
                    _ => prop.Value.GetRawText(),
                };
            }
            return result;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }
}
