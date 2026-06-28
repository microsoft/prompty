// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

public class ReplayVerifierTests
{
    [Fact]
    public void ReferenceReplayVerifier_PassesIdenticalRecords()
    {
        var record = new ReplayJournalRecord
        {
            Kind = ReplayRecordKind.Turn,
            Type = "turn_end",
            TurnId = "turn-1",
            Iteration = 1,
            Status = ReplayRecordStatus.Success
        };

        var result = new ReferenceReplayVerifier().Verify(new ReplayVerificationRequest
        {
            Expected = [record],
            Actual = [record]
        });

        Assert.Equal(ReplayVerificationStatus.Passed, result.Status);
        Assert.Empty(result.Mismatches!);
        Assert.Equal(1, result.ExpectedCount);
        Assert.Equal(1, result.ActualCount);
    }

    [Fact]
    public void ReferenceReplayVerifier_ReportsMismatches()
    {
        var result = new ReferenceReplayVerifier().Verify(new ReplayVerificationRequest
        {
            Expected =
            [
                new ReplayJournalRecord
                {
                    Kind = ReplayRecordKind.Summary,
                    SessionId = "session-1",
                    Status = ReplayRecordStatus.Success
                }
            ],
            Actual =
            [
                new ReplayJournalRecord
                {
                    Kind = ReplayRecordKind.Summary,
                    SessionId = "session-1",
                    Status = ReplayRecordStatus.Error
                }
            ]
        });

        Assert.Equal(ReplayVerificationStatus.Failed, result.Status);
        Assert.Equal(0, result.Mismatches![0].Index);
        Assert.Equal("Replay record mismatch", result.Mismatches![0].Message);
    }
}
