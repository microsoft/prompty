use prompty::model::{
    LoadContext, SaveContext, StreamChunk as ModelStreamChunk, StreamChunkKind,
    StreamFailure as ModelStreamFailure, StreamFailureOutcome,
};
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

#[test]
fn classified_failures_bridge_to_the_canonical_generated_model() {
    let compatibility = StreamFailure::Indeterminate("connection reset".to_string());
    let canonical = compatibility.to_model();

    assert_eq!(canonical.outcome, StreamFailureOutcome::Indeterminate);
    assert_eq!(canonical.message, "connection reset");
    assert_eq!(StreamFailure::from_model(canonical.clone()), compatibility);

    let chunk = ModelStreamChunk {
        kind: StreamChunkKind::FailureChunk { failure: canonical },
    };
    let saved = chunk.to_value(&SaveContext::default());
    let loaded = ModelStreamChunk::load_from_value(&saved, &LoadContext::default());
    assert_eq!(loaded, chunk);

    let StreamChunkKind::FailureChunk { failure } = loaded.kind else {
        panic!("canonical failure chunk must retain its discriminator");
    };
    assert_eq!(
        StreamFailure::from_model(ModelStreamFailure {
            outcome: failure.outcome,
            message: failure.message,
        }),
        compatibility
    );
}
