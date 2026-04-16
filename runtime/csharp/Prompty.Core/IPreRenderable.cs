// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Optional interface for parsers that can sanitize templates before rendering.
/// When implemented, the pipeline calls PreRender first to get a cleaned template
/// and context dict, then renders, then parses with that context.
/// </summary>
public interface IPreRenderable
{
    (string template, Dictionary<string, object?> context) PreRender(string template);
}
