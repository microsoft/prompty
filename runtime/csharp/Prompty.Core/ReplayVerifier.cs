// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;

namespace Prompty.Core;

public sealed class ReferenceReplayVerifier
{
    public ReplayVerificationResult Verify(ReplayVerificationRequest request)
    {
        var expected = request.Expected ?? [];
        var actual = request.Actual ?? [];
        var max = Math.Max(expected.Count, actual.Count);
        var mismatches = new List<ReplayMismatch>();

        for (var index = 0; index < max; index++)
        {
            var expectedRecord = index < expected.Count ? expected[index] : null;
            var actualRecord = index < actual.Count ? actual[index] : null;
            if (Comparable(expectedRecord) != Comparable(actualRecord))
            {
                mismatches.Add(new ReplayMismatch
                {
                    Index = index,
                    Expected = expectedRecord,
                    Actual = actualRecord,
                    Message = expectedRecord is null
                        ? "Unexpected extra replay record"
                        : actualRecord is null
                            ? "Missing replay record"
                            : "Replay record mismatch"
                });
            }
        }

        return new ReplayVerificationResult
        {
            Status = mismatches.Count == 0 ? ReplayVerificationStatus.Passed : ReplayVerificationStatus.Failed,
            Mismatches = mismatches,
            ExpectedCount = expected.Count,
            ActualCount = actual.Count
        };
    }

    private static string? Comparable(ReplayJournalRecord? record)
    {
        return record is null ? null : JsonSerializer.Serialize(record.Save());
    }
}
