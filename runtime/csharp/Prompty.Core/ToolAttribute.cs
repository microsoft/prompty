// Copyright (c) Microsoft. All rights reserved.

using System.Reflection;

namespace Prompty.Core;

/// <summary>
/// Marks a method as a tool function (spec §11.2).
/// When applied, the method can be auto-discovered and registered
/// as a FunctionTool with parameters derived from the method signature.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public class ToolAttribute : Attribute
{
    /// <summary>Override the tool name (defaults to method name).</summary>
    public string? Name { get; set; }
    /// <summary>Override the tool description.</summary>
    public string? Description { get; set; }

    /// <summary>
    /// Build a FunctionTool definition from a method decorated with [Tool].
    /// </summary>
    public static FunctionTool BuildFromMethod(MethodInfo method)
    {
        var attr = method.GetCustomAttribute<ToolAttribute>();
        var toolName = attr?.Name ?? method.Name;
        var toolDesc = attr?.Description ?? "";

        var parameters = new List<Property>();
        foreach (var param in method.GetParameters())
        {
            var kind = MapTypeToKind(param.ParameterType);
            var required = !param.HasDefaultValue;

            var prop = new Property
            {
                Name = param.Name ?? "",
                Kind = kind,
                Required = required,
            };

            if (param.HasDefaultValue)
                prop.Default = param.DefaultValue;

            parameters.Add(prop);
        }

        var tool = new FunctionTool
        {
            Name = toolName,
            Kind = "function",
            Description = toolDesc,
            Parameters = parameters,
        };

        return tool;
    }

    /// <summary>
    /// Discover all [Tool]-decorated methods on an object and register them
    /// in the global tool name registry.
    /// </summary>
    public static Dictionary<string, Func<string, Task<ToolResult>>> DiscoverTools(object instance)
    {
        var tools = new Dictionary<string, Func<string, Task<ToolResult>>>();
        var methods = instance.GetType()
            .GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Where(m => m.GetCustomAttribute<ToolAttribute>() is not null);

        foreach (var method in methods)
        {
            var toolDef = BuildFromMethod(method);
            var captured = method;

            Func<string, Task<ToolResult>> handler = async (argsJson) =>
            {
                var args = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object?>>(argsJson)
                    ?? new Dictionary<string, object?>();

                var methodParams = captured.GetParameters();
                var invokeArgs = new object?[methodParams.Length];

                for (int i = 0; i < methodParams.Length; i++)
                {
                    var paramName = methodParams[i].Name ?? "";
                    if (args.TryGetValue(paramName, out var val) && val is not null)
                    {
                        // Convert JsonElement to the target type
                        if (val is System.Text.Json.JsonElement je)
                            invokeArgs[i] = ConvertJsonElement(je, methodParams[i].ParameterType);
                        else
                            invokeArgs[i] = Convert.ChangeType(val, methodParams[i].ParameterType);
                    }
                    else if (methodParams[i].HasDefaultValue)
                    {
                        invokeArgs[i] = methodParams[i].DefaultValue;
                    }
                }

                var result = captured.Invoke(instance, invokeArgs);
                if (result is Task<ToolResult> taskTr)
                    return await taskTr;
                if (result is Task<string> taskStr)
                    return ToolResult.FromText(await taskStr);
                if (result is Task task)
                {
                    await task;
                    return ToolResult.FromText("");
                }
                return ToolResult.FromText(result?.ToString() ?? "");
            };

            tools[toolDef.Name] = handler;
            ToolDispatch.RegisterTool(toolDef.Name, handler);
        }

        return tools;
    }

    /// <summary>
    /// Discover [Tool]-decorated methods on an instance, validate them against
    /// the agent's tool declarations, and return a handler dictionary.
    /// </summary>
    /// <param name="agent">A loaded Prompty agent with tool declarations.</param>
    /// <param name="instance">An object instance with [Tool]-decorated methods.</param>
    /// <returns>Dictionary of tool name → handler, validated against agent.Tools.</returns>
    /// <exception cref="InvalidOperationException">
    /// If a handler has no matching declaration or duplicate handlers exist.
    /// </exception>
    public static Dictionary<string, Func<string, Task<ToolResult>>> BindTools(
        Prompty agent,
        object instance)
    {
        var handlers = new Dictionary<string, Func<string, Task<ToolResult>>>();

        var methods = instance.GetType()
            .GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Where(m => m.GetCustomAttribute<ToolAttribute>() is not null);

        foreach (var method in methods)
        {
            var toolDef = BuildFromMethod(method);
            var captured = method;

            Func<string, Task<ToolResult>> handler = async (argsJson) =>
            {
                var args = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object?>>(argsJson)
                    ?? new Dictionary<string, object?>();

                var methodParams = captured.GetParameters();
                var invokeArgs = new object?[methodParams.Length];

                for (int i = 0; i < methodParams.Length; i++)
                {
                    var paramName = methodParams[i].Name ?? "";
                    if (args.TryGetValue(paramName, out var val) && val is not null)
                    {
                        if (val is System.Text.Json.JsonElement je)
                            invokeArgs[i] = ConvertJsonElement(je, methodParams[i].ParameterType);
                        else
                            invokeArgs[i] = Convert.ChangeType(val, methodParams[i].ParameterType);
                    }
                    else if (methodParams[i].HasDefaultValue)
                    {
                        invokeArgs[i] = methodParams[i].DefaultValue;
                    }
                }

                var result = captured.Invoke(instance, invokeArgs);
                if (result is Task<ToolResult> taskTr)
                    return await taskTr;
                if (result is Task<string> taskStr)
                    return ToolResult.FromText(await taskStr);
                if (result is Task task)
                {
                    await task;
                    return ToolResult.FromText("");
                }
                return ToolResult.FromText(result?.ToString() ?? "");
            };

            if (handlers.ContainsKey(toolDef.Name))
                throw new InvalidOperationException($"Duplicate tool handler: '{toolDef.Name}'");

            handlers[toolDef.Name] = handler;
        }

        // Get declared function tool names from agent.Tools
        var declaredFunctionTools = new HashSet<string>();
        if (agent.Tools is not null)
        {
            foreach (var tool in agent.Tools)
            {
                if (tool.Kind == "function")
                    declaredFunctionTools.Add(tool.Name);
            }
        }

        // Validate: every handler must match a declaration
        foreach (var name in handlers.Keys)
        {
            if (!declaredFunctionTools.Contains(name))
            {
                var declared = declaredFunctionTools.Count > 0
                    ? string.Join(", ", declaredFunctionTools.OrderBy(x => x))
                    : "(none)";
                throw new InvalidOperationException(
                    $"Tool handler '{name}' has no matching 'kind: function' declaration in agent.Tools. " +
                    $"Declared function tools: {declared}");
            }
        }

        // Warn: every function declaration should have a handler
        foreach (var name in declaredFunctionTools)
        {
            if (!handlers.ContainsKey(name))
            {
                System.Diagnostics.Trace.TraceWarning(
                    $"Tool '{name}' is declared in agent.Tools but no handler was provided to BindTools()");
            }
        }

        return handlers;
    }

    private static string MapTypeToKind(Type type)
    {
        if (type == typeof(string)) return "string";
        if (type == typeof(int) || type == typeof(long)) return "integer";
        if (type == typeof(float) || type == typeof(double) || type == typeof(decimal)) return "float";
        if (type == typeof(bool)) return "boolean";
        if (type.IsArray || (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(List<>))) return "array";
        if (type.IsClass || (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Dictionary<,>))) return "object";
        return "string";
    }

    private static object? ConvertJsonElement(System.Text.Json.JsonElement je, Type target)
    {
        if (target == typeof(string)) return je.GetString();
        if (target == typeof(int)) return je.GetInt32();
        if (target == typeof(long)) return je.GetInt64();
        if (target == typeof(float)) return je.GetSingle();
        if (target == typeof(double)) return je.GetDouble();
        if (target == typeof(bool)) return je.GetBoolean();
        return je.ToString();
    }
}
