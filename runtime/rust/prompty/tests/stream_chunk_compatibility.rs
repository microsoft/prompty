use prompty::{StreamChunk, StreamFailure};

fn legacy_external_processor_error() -> StreamChunk {
    StreamChunk::Error("legacy processor error".to_string())
}

#[test]
fn external_processors_can_construct_and_match_legacy_string_errors() {
    match legacy_external_processor_error() {
        StreamChunk::Error(message) => assert_eq!(message, "legacy processor error"),
        _ => panic!("legacy StreamChunk::Error(String) construction must remain compatible"),
    }
}

#[test]
fn classified_failures_remain_available_for_indeterminate_reconciliation() {
    let chunk = StreamChunk::Failure(StreamFailure::Indeterminate("connection reset".to_string()));

    assert!(matches!(
        chunk,
        StreamChunk::Failure(failure) if failure.outcome_unknown()
    ));
}
