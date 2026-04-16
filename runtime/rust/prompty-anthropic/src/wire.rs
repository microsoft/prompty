//! Wire format conversion for the Anthropic Messages API.
//!
//! Converts Prompty's internal types (Message, ContentPart, Tool) into
//! the JSON structure expected by `POST /v1/messages`.
//!
//! Key differences from OpenAI:
//! - System messages → top-level `system` string (joined with `\n\n`)
//! - Content always uses block arrays: `[{type: "text", text: "..."}]`
//! - Images use `{type: "image", source: {type: "base64", media_type, data}}`
//! - Tools use `{name, description, input_schema}` (not wrapped in `{type: "function", function: ...}`)
//! - `max_tokens` required, defaults to 4096
//! - Options: `top_k`, `stop_sequences` (not `stop`)

use prompty::model::{Prompty, Property, PropertyKind, Tool, ToolKind};
use prompty::types::{ContentPart, Message, Role, ToolCall};
use serde_json::{Map, Value, json};

/// Default max_tokens when not specified (Anthropic requires this field).
const DEFAULT_MAX_TOKENS: i64 = 4096;

/// Anthropic API version header value.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";

// ---------------------------------------------------------------------------
// Top-level builders
// ---------------------------------------------------------------------------

/// Build the full request body for `POST /v1/messages`.
pub fn build_chat_args(agent: &Prompty, messages: &[Message]) -> Value {
    let mut body = Map::new();

    // Model ID
    body.insert("model".into(), json!(agent.model.id));

    // Extract system messages → top-level `system` field
    let system_text = extract_system(messages);
    if !system_text.is_empty() {
        body.insert("system".into(), json!(system_text));
    }

    // Non-system messages
    let wire_messages: Vec<Value> = messages
        .iter()
        .filter(|m| !matches!(m.role, Role::System | Role::Developer))
        .map(message_to_wire)
        .collect();
    body.insert("messages".into(), json!(wire_messages));

    // Options
    apply_options(agent, &mut body);

    // Tools
    if let Some(tools) = agent.as_tools() {
        if !tools.is_empty() {
            let wire_tools: Vec<Value> = tools.iter().map(tool_to_wire).collect();
            body.insert("tools".into(), json!(wire_tools));
        }
    }

    // Structured output (outputSchema → output_config)
    if let Some(output_config) = output_schema_to_wire(agent) {
        body.insert("output_config".into(), output_config);
    }

    Value::Object(body)
}

// ---------------------------------------------------------------------------
// System message extraction
// ---------------------------------------------------------------------------

/// Extract all system/developer messages and join their text with `\n\n`.
fn extract_system(messages: &[Message]) -> String {
    let parts: Vec<String> = messages
        .iter()
        .filter(|m| matches!(m.role, Role::System | Role::Developer))
        .map(|m| {
            m.parts
                .iter()
                .filter_map(|p| match p {
                    ContentPart::Text(t) => Some(t.value.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .collect();
    parts.join("\n\n")
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

/// Convert a single Message to Anthropic wire format.
///
/// Tool result messages (from the agent loop) are handled specially:
/// - Messages with `metadata["tool_results"]` become batched tool results
/// - Messages with `metadata["tool_use_id"]` become single tool results
/// - Assistant messages with `metadata["content"]` preserve raw content blocks
pub fn message_to_wire(msg: &Message) -> Value {
    let role = match msg.role {
        Role::User | Role::Tool => "user",
        Role::Assistant => "assistant",
        _ => "user",
    };

    // Check for batched tool results (from formatToolMessages)
    if let Some(tool_results) = msg.metadata.get("tool_results") {
        return json!({
            "role": role,
            "content": tool_results,
        });
    }

    // Check for single tool result
    if let Some(tool_use_id) = msg.metadata.get("tool_use_id").and_then(|v| v.as_str()) {
        let text = msg
            .parts
            .iter()
            .filter_map(|p| match p {
                ContentPart::Text(t) => Some(t.value.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");
        return json!({
            "role": role,
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": text,
            }],
        });
    }

    // Check for raw assistant content blocks (preserved from response)
    if let Some(raw_content) = msg.metadata.get("content") {
        return json!({
            "role": role,
            "content": raw_content,
        });
    }

    // Standard message with content parts
    let content: Vec<Value> = msg.parts.iter().map(part_to_wire).collect();
    json!({
        "role": role,
        "content": content,
    })
}

/// Convert a ContentPart to an Anthropic content block.
fn part_to_wire(part: &ContentPart) -> Value {
    match part {
        ContentPart::Text(t) => json!({
            "type": "text",
            "text": t.value,
        }),
        ContentPart::Image(img) => {
            if img.source.starts_with("http://") || img.source.starts_with("https://") {
                json!({
                    "type": "image",
                    "source": {
                        "type": "url",
                        "url": img.source,
                    },
                })
            } else {
                json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": img.media_type.as_deref().unwrap_or("image/png"),
                        "data": img.source,
                    },
                })
            }
        }
        // Audio and File parts degrade to text placeholders (Anthropic doesn't support them)
        ContentPart::Audio(_) => json!({
            "type": "text",
            "text": "[audio content not supported by Anthropic]",
        }),
        ContentPart::File(_) => json!({
            "type": "text",
            "text": "[file content not supported by Anthropic]",
        }),
    }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/// Fix f32 precision artifacts in a JSON value.
/// serde_json serializes f32 via f64, causing 0.1 → 0.10000000149011612.
/// Round-trip through f32 display to get a clean decimal representation.
fn fix_f32_value(v: Value) -> Value {
    if v.is_f64() {
        if let Some(f) = v.as_f64() {
            let s = format!("{}", f as f32);
            let clean: f64 = s.parse().unwrap_or(f);
            return json!(clean);
        }
    }
    v
}

/// Apply model options to the request body.
fn apply_options(agent: &Prompty, body: &mut Map<String, Value>) {
    let mut max_tokens = DEFAULT_MAX_TOKENS;

    if let Some(opts) = &agent.model.options {
        let wire = opts.to_wire("anthropic");
        if let Value::Object(map) = wire {
            for (k, v) in map {
                if k == "max_tokens" {
                    max_tokens = v.as_i64().unwrap_or(DEFAULT_MAX_TOKENS);
                } else {
                    body.insert(k, fix_f32_value(v));
                }
            }
        }

        // additionalProperties — merge any extra keys
        if let Some(map) = opts.additional_properties.as_object() {
            for (k, v) in map {
                if !body.contains_key(k) {
                    body.insert(k.clone(), v.clone());
                }
            }
        }
    }

    // max_tokens is always required for Anthropic
    body.insert("max_tokens".into(), json!(max_tokens));
}

// ---------------------------------------------------------------------------
// Structured output (outputSchema → output_config)
// ---------------------------------------------------------------------------

/// Convert `agent.outputs` to Anthropic's `output_config` format.
///
/// Anthropic uses: `output_config: { format: { type: "json_schema", schema: {...} } }`
fn output_schema_to_wire(agent: &Prompty) -> Option<Value> {
    let outputs = agent.as_outputs()?;
    if outputs.is_empty() {
        return None;
    }

    let mut properties = Map::new();
    let mut required = Vec::new();

    for prop in outputs {
        let kind_str = prop.kind_str();
        let json_type = match kind_str {
            "float" | "number" => "number",
            other => other,
        };

        let mut prop_schema = Map::new();
        prop_schema.insert("type".into(), json!(json_type));
        if let Some(ref desc) = prop.description {
            prop_schema.insert("description".into(), json!(desc));
        }

        properties.insert(prop.name.clone(), Value::Object(prop_schema));
        required.push(json!(prop.name));
    }

    Some(json!({
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": false,
            }
        }
    }))
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/// Convert a Tool to Anthropic's tool definition format.
///
/// Anthropic uses `{ name, description, input_schema }` at the top level,
/// unlike OpenAI's `{ type: "function", function: { name, description, parameters } }`.
fn tool_to_wire(tool: &Tool) -> Value {
    let mut wire = Map::new();
    wire.insert("name".into(), json!(tool.name));

    if let Some(ref desc) = tool.description {
        wire.insert("description".into(), json!(desc));
    }

    match &tool.kind {
        ToolKind::Function { parameters, .. } => {
            let schema = parameters_to_json_schema(parameters);
            wire.insert("input_schema".into(), schema);
        }
        _ => {
            // Non-function tools get an empty schema
            wire.insert(
                "input_schema".into(),
                json!({"type": "object", "properties": {}}),
            );
        }
    }

    Value::Object(wire)
}

/// Convert a single Property to a recursive JSON Schema definition.
fn property_to_json_schema(prop: &Property) -> Value {
    let mut schema = Map::new();
    let json_type = match prop.kind_str() {
        "string" => "string",
        "integer" => "integer",
        "float" | "number" => "number",
        "boolean" => "boolean",
        "array" => "array",
        "object" => "object",
        other => other,
    };
    schema.insert("type".into(), json!(json_type));

    if let Some(ref desc) = prop.description {
        schema.insert("description".into(), json!(desc));
    }
    if let Some(ref enum_vals) = prop.enum_values {
        schema.insert("enum".into(), Value::Array(enum_vals.clone()));
    }

    match &prop.kind {
        PropertyKind::Array { items } => {
            if !items.is_null() {
                let ctx = prompty::model::context::LoadContext::default();
                let item_prop = Property::load_from_value(items, &ctx);
                schema.insert("items".into(), property_to_json_schema(&item_prop));
            } else {
                schema.insert("items".into(), json!({"type": "string"}));
            }
        }
        PropertyKind::Object { properties } => {
            if !properties.is_empty() {
                let mut nested = Map::new();
                let mut req = Vec::new();
                for p in properties {
                    if p.name.is_empty() {
                        continue;
                    }
                    nested.insert(p.name.clone(), property_to_json_schema(p));
                    req.push(json!(p.name));
                }
                schema.insert("properties".into(), Value::Object(nested));
                schema.insert("required".into(), Value::Array(req));
            } else {
                schema.insert("properties".into(), json!({}));
                schema.insert("required".into(), json!([]));
            }
            schema.insert("additionalProperties".into(), Value::Bool(false));
        }
        _ => {}
    }

    Value::Object(schema)
}

/// Convert tool parameters to JSON Schema for `input_schema`.
fn parameters_to_json_schema(params: &[Property]) -> Value {
    let mut properties = Map::new();
    let mut required = Vec::new();

    for param in params {
        properties.insert(param.name.clone(), property_to_json_schema(param));
        if param.required.unwrap_or(false) {
            required.push(json!(param.name));
        }
    }

    let mut schema = json!({
        "type": "object",
        "properties": properties,
    });
    if !required.is_empty() {
        schema["required"] = json!(required);
    }
    schema
}

// ---------------------------------------------------------------------------
// Tool message formatting (for agent loop)
// ---------------------------------------------------------------------------

/// Format tool call results for the next turn in the agent loop.
///
/// Anthropic batches all tool results into a single user message.
/// Returns two messages:
/// 1. An assistant message with raw content blocks preserved
/// 2. A user message with all tool_result blocks
pub fn format_tool_messages(
    raw_response: &Value,
    tool_calls: &[ToolCall],
    tool_results: &[String],
) -> Vec<Message> {
    let mut messages = Vec::new();

    // 1. Assistant message with original content blocks
    let content_blocks = raw_response
        .get("content")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let mut assistant_msg = Message::text(Role::Assistant, "");
    assistant_msg
        .metadata
        .insert("content".into(), content_blocks);
    messages.push(assistant_msg);

    // 2. User message with batched tool results
    let tool_result_blocks: Vec<Value> = tool_calls
        .iter()
        .zip(tool_results.iter())
        .map(|(tc, result)| {
            json!({
                "type": "tool_result",
                "tool_use_id": tc.id,
                "content": result,
            })
        })
        .collect();

    let mut user_msg = Message::text(Role::User, "");
    user_msg
        .metadata
        .insert("tool_results".into(), json!(tool_result_blocks));
    messages.push(user_msg);

    messages
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::Prompty;
    use prompty::model::context::LoadContext;
    use prompty::types::{ImagePart, TextPart};

    fn make_agent(model_json: Value) -> Prompty {
        let mut data = json!({
            "name": "test",
            "kind": "prompt",
            "model": model_json,
        });
        data["instructions"] = json!("test");
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    fn make_agent_with_tools(model_json: Value, tools: Value) -> Prompty {
        let mut data = json!({
            "name": "test",
            "kind": "prompt",
            "model": model_json,
            "tools": tools,
        });
        data["instructions"] = json!("test");
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[test]
    fn test_system_extracted() {
        let agent = make_agent(json!({"id": "claude-3", "provider": "anthropic"}));
        let messages = vec![
            Message::text(Role::System, "Be helpful"),
            Message::text(Role::User, "Hello"),
        ];
        let args = build_chat_args(&agent, &messages);
        assert_eq!(args["system"], "Be helpful");
        // Messages should not contain system
        let msgs = args["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["role"], "user");
    }

    #[test]
    fn test_max_tokens_default() {
        let agent = make_agent(json!({"id": "claude-3", "provider": "anthropic"}));
        let messages = vec![Message::text(Role::User, "Hello")];
        let args = build_chat_args(&agent, &messages);
        assert_eq!(args["max_tokens"], 4096);
    }

    #[test]
    fn test_max_tokens_custom() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "options": {"maxOutputTokens": 2000}
        }));
        let messages = vec![Message::text(Role::User, "Hello")];
        let args = build_chat_args(&agent, &messages);
        assert_eq!(args["max_tokens"], 2000);
    }

    #[test]
    fn test_content_block_format() {
        let agent = make_agent(json!({"id": "claude-3", "provider": "anthropic"}));
        let messages = vec![Message::text(Role::User, "Hello")];
        let args = build_chat_args(&agent, &messages);
        let content = &args["messages"][0]["content"];
        assert!(content.is_array());
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "Hello");
    }

    #[test]
    fn test_image_base64_format() {
        let msg = Message {
            role: Role::User,
            parts: vec![
                ContentPart::Text(TextPart {
                    value: "Describe".to_string(),
                }),
                ContentPart::Image(ImagePart {
                    source: "base64data".to_string(),
                    detail: None,
                    media_type: Some("image/png".to_string()),
                }),
            ],
            metadata: Map::new(),
        };
        let wire = message_to_wire(&msg);
        let content = wire["content"].as_array().unwrap();
        assert_eq!(content[1]["type"], "image");
        assert_eq!(content[1]["source"]["type"], "base64");
        assert_eq!(content[1]["source"]["media_type"], "image/png");
        assert_eq!(content[1]["source"]["data"], "base64data");
    }

    #[test]
    fn test_image_url_format() {
        let msg = Message {
            role: Role::User,
            parts: vec![ContentPart::Image(ImagePart {
                source: "https://example.com/image.png".to_string(),
                detail: None,
                media_type: None,
            })],
            metadata: Map::new(),
        };
        let wire = message_to_wire(&msg);
        let content = wire["content"].as_array().unwrap();
        assert_eq!(content[0]["source"]["type"], "url");
    }

    #[test]
    fn test_tool_wire_format() {
        let agent = make_agent_with_tools(
            json!({"id": "claude-3", "provider": "anthropic"}),
            json!([{
                "name": "get_weather",
                "kind": "function",
                "description": "Get weather",
                "parameters": [
                    {"name": "city", "kind": "string", "required": true}
                ]
            }]),
        );
        let messages = vec![Message::text(Role::User, "Weather?")];
        let args = build_chat_args(&agent, &messages);
        let tools = args["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "get_weather");
        assert_eq!(tools[0]["description"], "Get weather");
        assert!(tools[0]["input_schema"]["properties"]["city"].is_object());
        assert_eq!(tools[0]["input_schema"]["required"][0], "city");
    }

    #[test]
    fn test_options_mapping() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "options": {
                "temperature": 0.5,
                "topP": 0.9,
                "topK": 40,
                "maxOutputTokens": 2000,
                "stopSequences": ["END"]
            }
        }));
        let messages = vec![Message::text(Role::User, "Hi")];
        let args = build_chat_args(&agent, &messages);
        assert_eq!(args["temperature"], 0.5);
        assert_eq!(args["top_p"], 0.9);
        assert_eq!(args["top_k"], 40);
        assert_eq!(args["max_tokens"], 2000);
        assert_eq!(args["stop_sequences"][0], "END");
    }

    #[test]
    fn test_format_tool_messages() {
        let raw_response = json!({
            "content": [
                {"type": "text", "text": "Let me check..."},
                {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "Paris"}}
            ]
        });
        let tool_calls = vec![ToolCall {
            id: "toolu_1".to_string(),
            name: "get_weather".to_string(),
            arguments: r#"{"city":"Paris"}"#.to_string(),
        }];
        let tool_results = vec!["Sunny, 22°C".to_string()];

        let msgs = format_tool_messages(&raw_response, &tool_calls, &tool_results);
        assert_eq!(msgs.len(), 2);

        // Assistant message preserves content blocks
        assert_eq!(msgs[0].role, Role::Assistant);
        assert!(msgs[0].metadata.contains_key("content"));

        // User message has batched tool results
        assert_eq!(msgs[1].role, Role::User);
        let results = msgs[1].metadata.get("tool_results").unwrap();
        let results_arr = results.as_array().unwrap();
        assert_eq!(results_arr.len(), 1);
        assert_eq!(results_arr[0]["type"], "tool_result");
        assert_eq!(results_arr[0]["tool_use_id"], "toolu_1");
    }

    #[test]
    fn test_no_system_when_none() {
        let agent = make_agent(json!({"id": "claude-3", "provider": "anthropic"}));
        let messages = vec![Message::text(Role::User, "Hello")];
        let args = build_chat_args(&agent, &messages);
        assert!(args.get("system").is_none());
    }

    #[test]
    fn test_multiple_system_messages_joined() {
        let agent = make_agent(json!({"id": "claude-3", "provider": "anthropic"}));
        let messages = vec![
            Message::text(Role::System, "Rule 1"),
            Message::text(Role::System, "Rule 2"),
            Message::text(Role::User, "Hello"),
        ];
        let args = build_chat_args(&agent, &messages);
        assert_eq!(args["system"], "Rule 1\n\nRule 2");
    }

    #[test]
    fn test_output_schema_to_wire() {
        let mut data = json!({
            "name": "structured",
            "kind": "prompt",
            "model": {"id": "claude-3", "provider": "anthropic"},
            "outputs": [
                {"name": "city", "kind": "string", "description": "The city name"},
                {"name": "temperature", "kind": "float"}
            ],
        });
        data["instructions"] = json!("test");
        let agent = Prompty::load_from_value(&data, &LoadContext::default());
        let messages = vec![Message::text(Role::User, "Weather?")];
        let args = build_chat_args(&agent, &messages);

        let oc = &args["output_config"];
        assert_eq!(oc["format"]["type"], "json_schema");
        let schema = &oc["format"]["schema"];
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["properties"]["city"]["type"], "string");
        assert_eq!(schema["properties"]["city"]["description"], "The city name");
        assert_eq!(schema["properties"]["temperature"]["type"], "number");
        assert_eq!(schema["additionalProperties"], false);
    }

    #[test]
    fn test_no_output_config_without_outputs() {
        let agent = make_agent(json!({"id": "claude-3", "provider": "anthropic"}));
        let messages = vec![Message::text(Role::User, "Hello")];
        let args = build_chat_args(&agent, &messages);
        assert!(args.get("output_config").is_none());
    }
}
