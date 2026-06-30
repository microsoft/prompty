use prompty::harness::ReferenceReplayVerifier;
use prompty::model::pipeline::replay_journal_record::{
    ReplayJournalRecord, ReplayRecordKind, ReplayRecordStatus,
};
use prompty::model::pipeline::replay_verification_request::ReplayVerificationRequest;
use prompty::model::pipeline::replay_verification_result::ReplayVerificationStatus;

#[test]
fn reference_replay_verifier_passes_identical_records() {
    let record = ReplayJournalRecord {
        kind: ReplayRecordKind::Turn,
        r#type: Some("turn_end".to_string()),
        turn_id: Some("turn-1".to_string()),
        iteration: Some(1),
        status: Some(ReplayRecordStatus::Success),
        ..Default::default()
    };

    let result = ReferenceReplayVerifier.verify(ReplayVerificationRequest {
        expected: vec![record.clone()],
        actual: vec![record],
    });

    assert_eq!(result.status, ReplayVerificationStatus::Passed);
    assert!(result.mismatches.is_empty());
    assert_eq!(result.expected_count, 1);
    assert_eq!(result.actual_count, 1);
}

#[test]
fn reference_replay_verifier_reports_mismatches() {
    let result = ReferenceReplayVerifier.verify(ReplayVerificationRequest {
        expected: vec![ReplayJournalRecord {
            kind: ReplayRecordKind::Summary,
            session_id: Some("session-1".to_string()),
            status: Some(ReplayRecordStatus::Success),
            ..Default::default()
        }],
        actual: vec![ReplayJournalRecord {
            kind: ReplayRecordKind::Summary,
            session_id: Some("session-1".to_string()),
            status: Some(ReplayRecordStatus::Error),
            ..Default::default()
        }],
    });

    assert_eq!(result.status, ReplayVerificationStatus::Failed);
    assert_eq!(result.mismatches[0].index, 0);
    assert_eq!(result.mismatches[0].message, "Replay record mismatch");
}
