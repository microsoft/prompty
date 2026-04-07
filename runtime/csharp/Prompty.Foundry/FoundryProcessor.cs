// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Foundry;

/// <summary>
/// Processes Azure OpenAI / Foundry responses.
/// Delegates entirely to OpenAIProcessor — same SDK, same response types.
/// Registered under keys "foundry" and "azure" (deprecated alias).
/// </summary>
public class FoundryProcessor : OpenAI.OpenAIProcessor
{
}
