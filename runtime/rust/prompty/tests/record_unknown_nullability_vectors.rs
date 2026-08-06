//! Record<unknown> nullability tests backed by the shared model vectors.

use std::path::PathBuf;

use prompty::model::context::{LoadContext, SaveContext};
use prompty::model::{
    HostToolRequest, Message, ModelInfo, Prompty, RunTurnRequest, SessionEvent, TurnEvent,
    TurnModelRequest, TurnModelResponse,
};
use serde_json::Value;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("runtime/rust/prompty must have a rust parent")
        .parent()
        .expect("runtime/rust must have a runtime parent")
        .parent()
        .expect("runtime must have a repository parent")
        .join("spec")
        .join("vectors")
        .join("model")
        .join("record_unknown_nullability_vectors.json")
}

macro_rules! roundtrip {
    ($model:ty, $json:expr) => {{
        let loaded =
            <$model>::from_json($json, &LoadContext::default()).expect("vector input must load");
        let saved = loaded.to_value(&SaveContext::default());
        let saved_json =
            serde_json::to_string(&saved).expect("saved model must be JSON-compatible");
        let reloaded = <$model>::from_json(&saved_json, &LoadContext::default())
            .expect("saved model must reload");
        reloaded.to_value(&SaveContext::default())
    }};
}

#[test]
fn record_unknown_nullability_vectors() {
    let raw = std::fs::read_to_string(vectors_path())
        .expect("failed to read Record<unknown> nullability vectors");
    let document: Value =
        serde_json::from_str(&raw).expect("failed to parse Record<unknown> nullability vectors");
    let vectors = document["vectors"]
        .as_array()
        .expect("Record<unknown> nullability vectors must contain a vectors array");

    for vector in vectors {
        let name = vector["name"]
            .as_str()
            .expect("vector name must be a string");
        assert_eq!(
            vector["operation"], "load-save-reload",
            "[{name}] unsupported vector operation"
        );
        let model = vector["model"]
            .as_str()
            .expect("vector model must be a string");
        let field_path = vector["fieldPath"]
            .as_str()
            .expect("vector fieldPath must be a string");
        let json =
            serde_json::to_string(&vector["input"]).expect("vector input must be JSON-compatible");

        let resaved = match model {
            "Message" => roundtrip!(Message, &json),
            "Prompty" => roundtrip!(Prompty, &json),
            "ModelInfo" => roundtrip!(ModelInfo, &json),
            "TurnModelRequest" => roundtrip!(TurnModelRequest, &json),
            "RunTurnRequest" => roundtrip!(RunTurnRequest, &json),
            "TurnModelResponse" => roundtrip!(TurnModelResponse, &json),
            "HostToolRequest" => roundtrip!(HostToolRequest, &json),
            "TurnEvent" => roundtrip!(TurnEvent, &json),
            "SessionEvent" => roundtrip!(SessionEvent, &json),
            _ => panic!("[{name}] unsupported model {model:?}"),
        };

        let actual = resaved
            .get(field_path)
            .unwrap_or_else(|| panic!("[{name}] reload lost field {field_path:?}"));
        assert_eq!(
            actual, &vector["expected"],
            "[{name}] reload changed null-valued record entries"
        );
    }
}
