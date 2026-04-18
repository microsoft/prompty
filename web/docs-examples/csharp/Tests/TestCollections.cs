// Copyright (c) Microsoft. All rights reserved.

using Xunit;

namespace DocsExamples.Tests;

/// <summary>
/// Serializes all doc-example tests so env-var mutations don't race between classes.
/// </summary>
[CollectionDefinition("DocsExamples")]
public class DocsExamplesCollection : ICollectionFixture<object>;
