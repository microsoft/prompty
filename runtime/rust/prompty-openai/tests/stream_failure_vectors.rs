use futures::StreamExt;
use prompty::types::{StreamChunk, StreamFailure};
use serde_json::{Value, json};

fn load_vectors() -> Vec<Value> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("spec")
        .join("vectors")
        .join("process")
        .join("stream_failure_vectors.json");
    serde_json::from_str(
        &std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("Failed to read {}: {error}", path.display())),
    )
    .expect("Invalid stream failure vectors")
}

fn provider_chunks(events: &[Value]) -> Vec<Value> {
    events
        .iter()
        .map(|event| match event["kind"].as_str() {
            Some("provider") => event["value"].clone(),
            Some("transportError") => json!({
                "error": {
                    "type": "sse_transport_error",
                    "message": event["message"],
                }
            }),
            kind => panic!("Unsupported stream vector event kind: {kind:?}"),
        })
        .collect()
}

fn chunk_to_value(chunk: StreamChunk) -> Value {
    match chunk {
        StreamChunk::Text(value) => json!({"kind": "text", "value": value}),
        StreamChunk::Failure(failure) => json!({
            "kind": "failure",
            "failure": {
                "outcome": if failure.outcome_unknown() {
                    "indeterminate"
                } else {
                    "determinate"
                },
                "message": failure.message(),
            }
        }),
        other => panic!("Unexpected processed stream chunk: {other:?}"),
    }
}

#[tokio::test]
async fn openai_stream_processor_matches_classified_failure_vectors() {
    for vector in load_vectors() {
        let input = &vector["input"];
        assert_eq!(input["provider"], "openai");
        let events = input["events"]
            .as_array()
            .expect("stream vector events must be an array");
        let chunks = provider_chunks(events);
        let actual: Vec<Value> =
            prompty_openai::processor::process_stream(futures::stream::iter(chunks))
                .map(chunk_to_value)
                .collect()
                .await;

        assert_eq!(
            Value::Array(actual),
            vector["expected"]["chunks"],
            "stream failure vector '{}' did not match",
            vector["name"]
        );
    }
}

#[test]
fn compatibility_failure_outcomes_match_vector_contract() {
    assert!(!StreamFailure::Determinate(String::new()).outcome_unknown());
    assert!(StreamFailure::Indeterminate(String::new()).outcome_unknown());
}
