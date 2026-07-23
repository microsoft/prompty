//! Wire format vector tests — validate against shared spec vectors.
//!
//! Reads `spec/vectors/wire/wire_vectors.json` and tests that our wire format
//! conversion matches the expected output for all OpenAI-provider vectors.

use prompty::model::Prompty;
use prompty::model::context::LoadContext;
use prompty::types::{ContentPart, Message, Role};
use prompty_openai::wire;
use serde_json::{Value, json};

fn spec_root() -> std::path::PathBuf {
    // runtime/rust/ → project root → spec/
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("spec")
}

fn load_wire_vectors() -> Vec<Value> {
    let path = spec_root()
        .join("vectors")
        .join("wire")
        .join("wire_vectors.json");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to read wire vectors at {}: {e}", path.display()));
    serde_json::from_str(&content).expect("Invalid JSON in wire_vectors.json")
}

/// Build messages from vector input content/messages format.
fn build_messages(input: &Value) -> Vec<Message> {
    let msgs = input["messages"]
        .as_array()
        .expect("messages should be array");
    msgs.iter()
        .map(|m| {
            let role = Role::from_str_opt(m["role"].as_str().unwrap()).unwrap();
            let content = m["content"].as_array().expect("content should be array");
            let parts: Vec<ContentPart> = content
                .iter()
                .map(|p| {
                    let kind = p["kind"].as_str().unwrap();
                    match kind {
                        "text" => ContentPart::text(p["value"].as_str().unwrap()),
                        "image" => ContentPart::image(
                            p["value"].as_str().unwrap(),
                            None,
                            p.get("mediaType")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                        ),
                        "audio" => ContentPart::audio(
                            p["value"].as_str().unwrap(),
                            p.get("mediaType")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                        ),
                        _ => panic!("Unknown content kind: {kind}"),
                    }
                })
                .collect();
            Message {
                role,
                parts,
                ..Default::default()
            }
        })
        .collect()
}

/// Build a Prompty agent from vector input fields.
fn build_agent(input: &Value) -> Prompty {
    let model_id = input["model_id"].as_str().unwrap_or("gpt-4");
    let api_type = input
        .get("apiType")
        .and_then(|v| v.as_str())
        .unwrap_or("chat");
    let provider = input
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("openai");

    let mut data = json!({
        "name": "test",
        "kind": "prompt",
        "model": {
            "id": model_id,
            "apiType": api_type,
            "provider": provider,
        },
        "instructions": "test",
    });

    if let Some(options) = input.get("options") {
        if options.is_object() && !options.as_object().unwrap().is_empty() {
            data["model"]["options"] = options.clone();
        }
    }

    if let Some(tools) = input.get("tools") {
        if tools.is_array() && !tools.as_array().unwrap().is_empty() {
            data["tools"] = tools.clone();
        }
    }

    if let Some(outputs) = input.get("outputs") {
        if outputs.is_array() && !outputs.as_array().unwrap().is_empty() {
            data["outputs"] = outputs.clone();
        }
    }

    Prompty::load_from_value(&data, &LoadContext::default())
}

/// Compare two JSON values, ignoring key order in objects.
fn json_eq(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(a), Value::Object(b)) => {
            if a.len() != b.len() {
                return false;
            }
            a.iter()
                .all(|(k, v)| b.get(k).is_some_and(|bv| json_eq(v, bv)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(av, bv)| json_eq(av, bv))
        }
        _ => actual == expected,
    }
}

// ---------------------------------------------------------------------------
// Individual vector tests
// ---------------------------------------------------------------------------

macro_rules! wire_test {
    ($name:ident) => {
        #[test]
        fn $name() {
            let vectors = load_wire_vectors();
            let test_name = stringify!($name);
            let vector = vectors
                .iter()
                .find(|v| v["name"].as_str() == Some(test_name))
                .unwrap_or_else(|| panic!("Vector '{test_name}' not found"));

            let input = &vector["input"];
            let provider = input
                .get("provider")
                .and_then(|v| v.as_str())
                .unwrap_or("openai");

            // Skip non-OpenAI vectors
            if provider != "openai" {
                return;
            }

            let agent = build_agent(input);
            let messages = build_messages(input);
            let api_type = input
                .get("apiType")
                .and_then(|v| v.as_str())
                .unwrap_or("chat");

            let actual = match api_type {
                "chat" | "agent" => wire::build_chat_args(&agent, &messages),
                "responses" => wire::build_responses_args(&agent, &messages),
                "embedding" => Ok(wire::build_embedding_args(&agent, &messages)),
                "image" => Ok(wire::build_image_args(&agent, &messages)),
                _ => panic!("Unknown apiType: {api_type}"),
            }
            .unwrap_or_else(|error| panic!("Vector '{test_name}' schema error: {error}"));

            let expected = &vector["expected"]["request_body"];

            assert!(
                json_eq(&actual, expected),
                "Vector '{test_name}' mismatch:\n  actual:   {}\n  expected: {}",
                serde_json::to_string_pretty(&actual).unwrap(),
                serde_json::to_string_pretty(expected).unwrap(),
            );
        }
    };
}

wire_test!(chat_simple);
wire_test!(chat_with_options);
wire_test!(chat_single_text_optimized);
wire_test!(chat_multipart_content);
wire_test!(chat_audio_part);
wire_test!(chat_audio_mp3);
wire_test!(tools_function_wire);
wire_test!(tools_strict_mode);
wire_test!(embedding_wire);
wire_test!(image_wire);
wire_test!(kind_to_json_type_mapping);
wire_test!(chat_image_part);
wire_test!(structured_output);
wire_test!(options_max_completion_tokens);
wire_test!(options_stop_sequences);
wire_test!(options_additional_properties);
wire_test!(tools_bindings_stripped);
wire_test!(tools_null_when_empty);
wire_test!(chat_image_base64);
wire_test!(responses_simple);
wire_test!(responses_with_tools);
wire_test!(responses_structured_output);

fn function_parameters_schema(parameters: Value) -> Result<Value, wire::SchemaError> {
    let agent = Prompty::load_from_value(
        &json!({
            "name": "set-row-visual-test",
            "kind": "prompt",
            "model": { "id": "gpt-4", "provider": "openai" },
            "instructions": "test",
            "tools": [{
                "name": "set_row_visual",
                "kind": "function",
                "strict": true,
                "parameters": parameters,
            }],
        }),
        &LoadContext::default(),
    );

    wire::build_chat_args(&agent, &[]).map(|request| {
        request
            .pointer("/tools/0/function/parameters")
            .cloned()
            .expect("function parameters schema")
    })
}

fn assert_no_empty_type(schema: &Value) {
    match schema {
        Value::Object(values) => {
            assert_ne!(
                values.get("type"),
                Some(&Value::String(String::new())),
                "schemas must not emit an empty JSON Schema type: {schema}"
            );
            for value in values.values() {
                assert_no_empty_type(value);
            }
        }
        Value::Array(values) => {
            for value in values {
                assert_no_empty_type(value);
            }
        }
        _ => {}
    }
}

#[test]
fn set_row_visual_schema_supports_nullable_unions_and_nested_optionality() {
    let schema = function_parameters_schema(json!([
        {
            "name": "row",
            "kind": "object",
            "required": true,
            "properties": [
                {
                    "name": "color",
                    "kind": "string",
                    "nullable": true,
                    "required": true
                },
                {
                    "name": "border",
                    "kind": "union",
                    "nullable": true,
                    "anyOf": [
                        { "kind": "string", "enumValues": ["thin"] },
                        { "kind": "string", "enumValues": ["thick"] }
                    ],
                    "required": false
                },
                {
                    "name": "fill",
                    "kind": "union",
                    "anyOf": [
                        { "kind": "string" },
                        {
                            "kind": "object",
                            "properties": [
                                { "name": "theme", "kind": "string", "required": true },
                                { "name": "tint", "kind": "float", "required": false }
                            ]
                        }
                    ],
                    "required": true
                }
            ]
        }
    ]))
    .expect("valid anyOf union schema");

    assert_eq!(schema["properties"]["row"]["type"], "object");
    assert_eq!(
        schema["properties"]["row"]["required"],
        json!(["color", "fill"])
    );
    assert_eq!(
        schema["properties"]["row"]["properties"]["color"]["type"],
        json!(["string", "null"])
    );
    assert_eq!(
        schema["properties"]["row"]["properties"]["border"]["anyOf"][0]["type"],
        "string"
    );
    assert_eq!(
        schema["properties"]["row"]["properties"]["border"]["anyOf"][1]["type"],
        "string"
    );
    assert_eq!(
        schema["properties"]["row"]["properties"]["border"]["anyOf"][2],
        json!({ "type": "null" })
    );
    assert_eq!(
        schema["properties"]["row"]["properties"]["fill"]["anyOf"][0]["type"],
        "string"
    );
    assert_eq!(
        schema["properties"]["row"]["properties"]["fill"]["anyOf"][1]["type"],
        "object"
    );
    assert_eq!(
        schema["properties"]["row"]["properties"]["fill"]["anyOf"][1]["required"],
        json!(["theme"])
    );
    assert_no_empty_type(&schema);
}

#[test]
fn strict_openai_schemas_use_required_nullable_optionals_and_nullable_enums() {
    let schema = function_parameters_schema(json!([
        {
            "name": "choice",
            "kind": "string",
            "required": false,
            "nullable": true,
            "enumValues": ["yes", "no"]
        },
        {
            "name": "extension",
            "kind": "my-extension",
            "required": false,
            "nullable": true
        }
    ]))
    .expect("strict schema");

    assert_eq!(schema["required"], json!(["choice", "extension"]));
    assert_eq!(
        schema["properties"]["choice"]["type"],
        json!(["string", "null"])
    );
    assert_eq!(
        schema["properties"]["choice"]["enum"],
        json!(["yes", "no", null])
    );
    assert_eq!(schema["properties"]["extension"], json!({}));
}

#[test]
fn strict_openai_schemas_reject_one_of_unions() {
    let result = function_parameters_schema(json!([{
        "name": "invalid",
        "kind": "union",
        "oneOf": [{"kind": "string"}, {"kind": "integer"}]
    }]));

    assert!(
        result.is_err(),
        "oneOf must be rejected before sending to OpenAI"
    );
}

#[test]
fn openai_schemas_reject_malformed_unions_without_panicking() {
    for union in [
        json!({"name": "invalid", "kind": "union"}),
        json!({
            "name": "invalid",
            "kind": "union",
            "oneOf": [{"kind": "string"}],
            "anyOf": [{"kind": "integer"}]
        }),
    ] {
        assert!(
            function_parameters_schema(json!([union])).is_err(),
            "malformed unions must return an error"
        );
    }
}
