// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Valid message roles in the Prompty pipeline.
/// </summary>
public static class Roles
{
    public const string System = "system";
    public const string User = "user";
    public const string Assistant = "assistant";
    public const string Developer = "developer";
    public const string Tool = "tool";

    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        System, User, Assistant, Developer, Tool
    };
}

/// <summary>
/// Input kinds that receive special handling during rendering/parsing.
/// </summary>
public static class RichKinds
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        "thread", "image", "file", "audio"
    };
}

/// <summary>
/// Placeholder inserted by renderers to mark where thread/rich content should be expanded.
/// </summary>
public partial class ThreadMarker { }
