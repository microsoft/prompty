//! Wire format conversion for the OpenAI Chat Completions API.
//!
//! Converts Prompty `Message`s, tools, options, and output schemas into the
//! JSON bodies expected by the OpenAI API.

use prompty::model::{ModelOptions, Prompty, Property, PropertyKind, Tool, ToolKind};
use prompty::types::{ContentPart, Message};
use serde_json::{Map, Value, json};

// ---------------------------------------------------------------------------
// Message → OpenAI wire format
// ---------------------------------------------------------------------------

/// Convert a `Message` to the OpenAI wire format.
pub fn message_to_wire(msg: &Message) -> Value {
    let mut obj = Map::new();
    obj.insert("role".to_string(), Value::String(msg.role.to_string()));

    // Copy metadata fields (tool_call_id, tool_calls, name, etc.)
    for (k, v) in &msg.metadata {
        if k != "role" && k != "content" {
            obj.insert(k.clone(), v.clone());
        }
    }

    // Content: single text part → plain string, else array of typed blocks
    let content = msg.to_text_content();
    if content.is_string() {
        obj.insert("content".to_string(), content);
    } else {
        // Multipart — convert each part to wire format
        let parts: Vec<Value> = msg.parts.iter().map(part_to_wire).collect();
        obj.insert("content".to_string(), Value::Array(parts));
    }

    Value::Object(obj)
}

fn part_to_wire(part: &ContentPart) -> Value {
    match part {
        ContentPart::Text(tp) => json!({
            "type": "text",
            "text": tp.value,
        }),
        ContentPart::Image(ip) => {
            let mut img = Map::new();
            img.insert("url".to_string(), Value::String(ip.source.clone()));
            if let Some(ref detail) = ip.detail {
                img.insert("detail".to_string(), Value::String(detail.clone()));
            }
            json!({
                "type": "image_url",
                "image_url": Value::Object(img),
            })
        }
        ContentPart::Audio(ap) => {
            let format = ap
                .media_type
                .as_deref()
                .map(mime_to_audio_format)
                .unwrap_or_else(|| "wav".to_string());
            json!({
                "type": "input_audio",
                "input_audio": {
                    "data": ap.source,
                    "format": format,
                },
            })
        }
        ContentPart::File(fp) => json!({
            "type": "file",
            "file": { "url": fp.source },
        }),
    }
}

fn mime_to_audio_format(mime: &str) -> String {
    match mime {
        "audio/wav" | "audio/x-wav" => "wav".to_string(),
        "audio/mpeg" | "audio/mp3" => "mp3".to_string(),
        "audio/mp4" => "mp4".to_string(),
        "audio/ogg" => "ogg".to_string(),
        "audio/flac" => "flac".to_string(),
        "audio/webm" => "webm".to_string(),
        "audio/pcm" => "pcm".to_string(),
        // Per spec §7.1.2: strip "audio/" prefix for unmapped types
        other => other.strip_prefix("audio/").unwrap_or("wav").to_string(),
    }
}

// ---------------------------------------------------------------------------
// Build request arguments
// ---------------------------------------------------------------------------

/// Build the full request body for a chat completions call.
pub fn build_chat_args(agent: &Prompty, messages: &[Message]) -> Value {
    let mut args = Map::new();

    // Model ID
    args.insert("model".to_string(), Value::String(agent.model.id.clone()));

    // Messages
    let wire_msgs: Vec<Value> = messages.iter().map(message_to_wire).collect();
    args.insert("messages".to_string(), Value::Array(wire_msgs));

    // Options
    apply_options(&mut args, &agent.model.options);

    // Tools
    let tools = tools_to_wire(agent);
    if !tools.is_empty() {
        args.insert("tools".to_string(), Value::Array(tools));
    }

    // Structured output (response_format)
    if let Some(rf) = output_schema_to_wire(agent) {
        args.insert("response_format".to_string(), rf);
    }

    Value::Object(args)
}

/// Build the request body for an embedding call.
pub fn build_embedding_args(agent: &Prompty, messages: &[Message]) -> Value {
    let model = if agent.model.id.is_empty() {
        "text-embedding-ada-002".to_string()
    } else {
        agent.model.id.clone()
    };

    let input = extract_text_input(messages);

    let mut args = json!({
        "model": model,
        "input": input,
    });

    // Only additionalProperties from options
    if let Some(ref opts) = agent.model.options {
        if let Some(map) = opts.additional_properties.as_object() {
            for (k, v) in map {
                args[k.clone()] = v.clone();
            }
        }
    }

    args
}

/// Build the request body for an image generation call.
pub fn build_image_args(agent: &Prompty, messages: &[Message]) -> Value {
    let model = if agent.model.id.is_empty() {
        "dall-e-3".to_string()
    } else {
        agent.model.id.clone()
    };

    let prompt = extract_text_input(messages);
    let prompt_str = match prompt {
        Value::Array(arr) => arr
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        Value::String(s) => s,
        _ => String::new(),
    };

    let mut args = json!({
        "model": model,
        "prompt": prompt_str,
    });

    // Only additionalProperties from options
    if let Some(ref opts) = agent.model.options {
        if let Some(map) = opts.additional_properties.as_object() {
            for (k, v) in map {
                args[k.clone()] = v.clone();
            }
        }
    }

    args
}

fn extract_text_input(messages: &[Message]) -> Value {
    let texts: Vec<String> = messages
        .iter()
        .map(|m| m.text_content())
        .filter(|s| !s.is_empty())
        .collect();

    if texts.len() == 1 {
        Value::String(texts.into_iter().next().unwrap())
    } else {
        Value::Array(texts.into_iter().map(Value::String).collect())
    }
}

// ---------------------------------------------------------------------------
// Options mapping
// ---------------------------------------------------------------------------

/// Convert f32 to JSON Value without precision artifacts.
/// f32 0.1 → "0.1" not "0.10000000149011612"
fn f32_to_json(v: f32) -> Value {
    // Round-trip through string to get clean decimal representation
    let s = format!("{}", v);
    let f: f64 = s.parse().unwrap_or(v as f64);
    json!(f)
}

fn apply_options(args: &mut Map<String, Value>, opts: &Option<ModelOptions>) {
    let Some(opts) = opts else { return };

    if let Some(t) = opts.temperature {
        args.insert("temperature".to_string(), f32_to_json(t));
    }
    if let Some(m) = opts.max_output_tokens {
        args.insert("max_completion_tokens".to_string(), json!(m));
    }
    if let Some(p) = opts.top_p {
        args.insert("top_p".to_string(), f32_to_json(p));
    }
    if let Some(f) = opts.frequency_penalty {
        args.insert("frequency_penalty".to_string(), f32_to_json(f));
    }
    if let Some(p) = opts.presence_penalty {
        args.insert("presence_penalty".to_string(), f32_to_json(p));
    }
    if let Some(s) = opts.seed {
        args.insert("seed".to_string(), json!(s));
    }
    if let Some(ref stop) = opts.stop_sequences {
        args.insert("stop".to_string(), json!(stop));
    }

    // additionalProperties — merge any extra keys
    if let Some(map) = opts.additional_properties.as_object() {
        for (k, v) in map {
            if !args.contains_key(k) {
                args.insert(k.clone(), v.clone());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tool wire format
// ---------------------------------------------------------------------------

/// Convert agent's tools to OpenAI wire format.
pub fn tools_to_wire(agent: &Prompty) -> Vec<Value> {
    if agent.tools.is_empty() {
        return Vec::new();
    }

    agent.tools
        .iter()
        .filter(|tool| matches!(tool.kind, ToolKind::Function { .. }))
        .map(function_tool_to_wire)
        .collect()
}

fn function_tool_to_wire(tool: &Tool) -> Value {
    let (parameters, strict) = match &tool.kind {
        ToolKind::Function { parameters, strict } => (parameters, strict),
        _ => return json!({}),
    };

    let mut func_def = Map::new();
    func_def.insert("name".to_string(), Value::String(tool.name.clone()));

    if let Some(ref desc) = tool.description {
        func_def.insert("description".to_string(), Value::String(desc.clone()));
    }

    // Collect bound parameter names to strip from wire format (§7.1.3)
    let bound_names: std::collections::HashSet<String> = tool
        .bindings
        .iter()
        .map(|b| b.name.clone())
        .collect();

    // Parameters → JSON Schema, filtering out bound params
    if !parameters.is_empty() {
        let typed_params: Vec<Property> = parameters
            .iter()
            .filter(|p| !bound_names.contains(&p.name))
            .cloned()
            .collect();
        let schema = parameters_to_json_schema(&typed_params);
        func_def.insert("parameters".to_string(), schema);
    }

    // strict mode
    if strict.unwrap_or(false) {
        func_def.insert("strict".to_string(), Value::Bool(true));
        // Add additionalProperties: false to parameters schema
        if let Some(Value::Object(params)) = func_def.get_mut("parameters") {
            params.insert("additionalProperties".to_string(), Value::Bool(false));
        }
    }

    json!({
        "type": "function",
        "function": Value::Object(func_def),
    })
}

/// Convert a single Property to a recursive JSON Schema definition.
fn property_to_json_schema(prop: &Property) -> Value {
    let mut schema = Map::new();
    schema.insert(
        "type".to_string(),
        Value::String(kind_to_json_type(prop.kind_str())),
    );

    if let Some(ref desc) = prop.description {
        schema.insert("description".to_string(), Value::String(desc.clone()));
    }
    if let Some(ref enum_vals) = prop.enum_values {
        schema.insert("enum".to_string(), Value::Array(enum_vals.clone()));
    }

    match &prop.kind {
        PropertyKind::Array { items } => {
            if !items.is_null() {
                let ctx = prompty::model::context::LoadContext::default();
                let item_prop = Property::load_from_value(items, &ctx);
                schema.insert("items".to_string(), property_to_json_schema(&item_prop));
            }
            // When items is null/unspecified, emit bare {"type": "array"}
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
                    req.push(Value::String(p.name.clone()));
                }
                schema.insert("properties".to_string(), Value::Object(nested));
                schema.insert("required".to_string(), Value::Array(req));
                schema.insert("additionalProperties".to_string(), Value::Bool(false));
            }
            // When properties is empty or absent, emit bare {"type": "object"}
        }
        _ => {}
    }

    Value::Object(schema)
}

fn parameters_to_json_schema(params: &[Property]) -> Value {
    let mut properties = Map::new();
    let mut required = Vec::new();

    for param in params {
        properties.insert(param.name.clone(), property_to_json_schema(param));

        if param.required.unwrap_or(false) {
            required.push(Value::String(param.name.clone()));
        }
    }

    let mut schema = Map::new();
    schema.insert("type".to_string(), Value::String("object".to_string()));
    schema.insert("properties".to_string(), Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".to_string(), Value::Array(required));
    }
    Value::Object(schema)
}

fn kind_to_json_type(kind: &str) -> String {
    match kind {
        "string" => "string".to_string(),
        "integer" => "integer".to_string(),
        "float" | "number" => "number".to_string(),
        "boolean" => "boolean".to_string(),
        "array" => "array".to_string(),
        "object" => "object".to_string(),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Structured output (outputSchema → response_format)
// ---------------------------------------------------------------------------

fn output_schema_to_wire(agent: &Prompty) -> Option<Value> {
    if agent.outputs.is_empty() {
        return None;
    }

    let mut properties = Map::new();
    let mut required = Vec::new();

    for prop in &agent.outputs {
        properties.insert(prop.name.clone(), property_to_json_schema(prop));
        if prop.required.unwrap_or(false) {
            required.push(Value::String(prop.name.clone()));
        }
    }

    let mut schema = Map::new();
    schema.insert("type".to_string(), Value::String("object".to_string()));
    schema.insert("properties".to_string(), Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".to_string(), Value::Array(required));
    }
    schema.insert("additionalProperties".to_string(), Value::Bool(false));

    Some(json!({
        "type": "json_schema",
        "json_schema": {
            "name": "structured_output",
            "strict": true,
            "schema": Value::Object(schema),
        },
    }))
}

// ---------------------------------------------------------------------------
// Responses API wire format
// ---------------------------------------------------------------------------

/// Build the request body for the OpenAI Responses API.
///
/// System/developer messages become `instructions`; other messages become `input` items.
pub fn build_responses_args(agent: &Prompty, messages: &[Message]) -> Value {
    let model = if agent.model.id.is_empty() {
        "gpt-4o".to_string()
    } else {
        agent.model.id.clone()
    };

    let mut system_parts: Vec<String> = Vec::new();
    let mut input_messages: Vec<Value> = Vec::new();

    for msg in messages {
        let role_str = msg.role.to_string();
        if role_str == "system" || role_str == "developer" {
            system_parts.push(msg.text_content());
        } else {
            input_messages.push(message_to_responses_input(msg));
        }
    }

    let mut args = Map::new();
    args.insert("model".to_string(), Value::String(model));
    args.insert("input".to_string(), Value::Array(input_messages));

    if !system_parts.is_empty() {
        args.insert(
            "instructions".to_string(),
            Value::String(system_parts.join("\n\n")),
        );
    }

    // Options
    apply_responses_options(&mut args, &agent.model.options);

    // Tools (flat format — no nested "function" key)
    let tools = responses_tools_to_wire(agent);
    if !tools.is_empty() {
        args.insert("tools".to_string(), Value::Array(tools));
    }

    // Structured output via text.format
    if let Some(text_config) = output_schema_to_responses_wire(agent) {
        args.insert("text".to_string(), text_config);
    }

    Value::Object(args)
}

fn message_to_responses_input(msg: &Message) -> Value {
    let content = msg.to_text_content();

    // Pass-through function_call items from agent loop
    if let Some(fc) = msg.metadata.get("responses_function_call") {
        return fc.clone();
    }

    // Tool result → function_call_output
    if let Some(call_id) = msg.metadata.get("tool_call_id") {
        let output = if content.is_string() {
            content.as_str().unwrap_or("").to_string()
        } else {
            serde_json::to_string(&content).unwrap_or_default()
        };
        return json!({
            "type": "function_call_output",
            "call_id": call_id,
            "output": output,
        });
    }

    let role = if msg.role.to_string() == "tool" {
        "user".to_string()
    } else {
        msg.role.to_string()
    };

    let mut obj = Map::new();
    obj.insert("role".to_string(), Value::String(role));
    obj.insert("content".to_string(), content);
    Value::Object(obj)
}

fn apply_responses_options(args: &mut Map<String, Value>, opts: &Option<ModelOptions>) {
    let Some(opts) = opts else { return };

    if let Some(t) = opts.temperature {
        args.insert("temperature".to_string(), f32_to_json(t));
    }
    if let Some(m) = opts.max_output_tokens {
        args.insert("max_output_tokens".to_string(), json!(m));
    }
    if let Some(p) = opts.top_p {
        args.insert("top_p".to_string(), f32_to_json(p));
    }

    // additionalProperties — pass through without overwriting
    if let Some(map) = opts.additional_properties.as_object() {
        for (k, v) in map {
            if !args.contains_key(k) {
                args.insert(k.clone(), v.clone());
            }
        }
    }
}

fn responses_tools_to_wire(agent: &Prompty) -> Vec<Value> {
    if agent.tools.is_empty() {
        return Vec::new();
    }

    agent.tools
        .iter()
        .filter(|tool| matches!(tool.kind, ToolKind::Function { .. }))
        .map(responses_function_tool_to_wire)
        .collect()
}

fn responses_function_tool_to_wire(tool: &Tool) -> Value {
    let (parameters, strict) = match &tool.kind {
        ToolKind::Function { parameters, strict } => (parameters, strict),
        _ => return json!({}),
    };

    // Responses API uses flat format: { type, name, description, parameters }
    let mut obj = Map::new();
    obj.insert("type".to_string(), Value::String("function".to_string()));
    obj.insert("name".to_string(), Value::String(tool.name.clone()));

    if let Some(ref desc) = tool.description {
        obj.insert("description".to_string(), Value::String(desc.clone()));
    }

    // Collect bound parameter names to strip (§7.1.3)
    let bound_names: std::collections::HashSet<String> = tool
        .bindings
        .iter()
        .map(|b| b.name.clone())
        .collect();

    if !parameters.is_empty() {
        let typed_params: Vec<Property> = parameters
            .iter()
            .filter(|p| !bound_names.contains(&p.name))
            .cloned()
            .collect();
        let schema = parameters_to_json_schema(&typed_params);
        obj.insert("parameters".to_string(), schema);
    }

    if strict.unwrap_or(false) {
        obj.insert("strict".to_string(), Value::Bool(true));
        if let Some(Value::Object(params)) = obj.get_mut("parameters") {
            params.insert("additionalProperties".to_string(), Value::Bool(false));
        }
    }

    Value::Object(obj)
}

fn output_schema_to_responses_wire(agent: &Prompty) -> Option<Value> {
    if agent.outputs.is_empty() {
        return None;
    }

    let mut properties = Map::new();
    let mut required = Vec::new();

    for prop in &agent.outputs {
        properties.insert(prop.name.clone(), property_to_json_schema(prop));
        required.push(Value::String(prop.name.clone()));
    }

    let mut schema = Map::new();
    schema.insert("type".to_string(), Value::String("object".to_string()));
    schema.insert("properties".to_string(), Value::Object(properties));
    schema.insert("required".to_string(), Value::Array(required));
    schema.insert("additionalProperties".to_string(), Value::Bool(false));

    Some(json!({
        "format": {
            "type": "json_schema",
            "name": "structured_output",
            "schema": Value::Object(schema),
            "strict": true,
        },
    }))
}

// ---------------------------------------------------------------------------
// Format tool messages (for agent loop)
// ---------------------------------------------------------------------------

/// Format tool call results back into messages for the conversation.
///
/// Produces: one assistant message with `tool_calls` metadata, then one
/// `tool` role message per result with rich content parts.
pub fn format_tool_messages(
    tool_calls: &[prompty::types::ToolCall],
    results: &[prompty::types::ToolResult],
) -> Vec<Message> {
    let mut messages = Vec::new();

    // Assistant message with tool_calls metadata
    let wire_calls: Vec<Value> = tool_calls
        .iter()
        .map(|tc| {
            json!({
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.name,
                    "arguments": tc.arguments,
                },
            })
        })
        .collect();

    let mut assistant = Message::text(prompty::Role::Assistant, "");
    assistant
        .metadata
        .insert("tool_calls".to_string(), Value::Array(wire_calls));
    messages.push(assistant);

    // One tool result message per call — using rich content parts
    for (tc, result) in tool_calls.iter().zip(results) {
        let mut msg = Message::tool_result_rich(&tc.id, result);
        msg.metadata
            .insert("name".to_string(), Value::String(tc.name.clone()));
        messages.push(msg);
    }

    messages
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::types::{AudioPart, ImagePart, TextPart};

    #[test]
    fn test_message_to_wire_text() {
        let msg = Message::text(prompty::Role::User, "Hello");
        let wire = message_to_wire(&msg);
        assert_eq!(wire["role"], "user");
        assert_eq!(wire["content"], "Hello");
    }

    #[test]
    fn test_message_to_wire_multipart() {
        let msg = Message {
            role: prompty::Role::User,
            parts: vec![
                ContentPart::Text(TextPart {
                    value: "Describe".to_string(),
                }),
                ContentPart::Image(ImagePart {
                    source: "https://img.png".to_string(),
                    detail: None,
                    media_type: None,
                }),
            ],
            metadata: Map::new(),
        };
        let wire = message_to_wire(&msg);
        assert_eq!(wire["role"], "user");
        let content = wire["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["type"], "image_url");
        assert_eq!(content[1]["image_url"]["url"], "https://img.png");
    }

    #[test]
    fn test_message_to_wire_audio() {
        let msg = Message {
            role: prompty::Role::User,
            parts: vec![ContentPart::Audio(AudioPart {
                source: "base64data".to_string(),
                media_type: Some("audio/mpeg".to_string()),
            })],
            metadata: Map::new(),
        };
        let wire = message_to_wire(&msg);
        let content = wire["content"].as_array().unwrap();
        assert_eq!(content[0]["type"], "input_audio");
        assert_eq!(content[0]["input_audio"]["format"], "mp3");
    }

    #[test]
    fn test_message_to_wire_metadata() {
        let mut msg = Message::text(prompty::Role::Tool, "result");
        msg.metadata
            .insert("tool_call_id".to_string(), json!("call_123"));
        msg.metadata
            .insert("name".to_string(), json!("get_weather"));
        let wire = message_to_wire(&msg);
        assert_eq!(wire["tool_call_id"], "call_123");
        assert_eq!(wire["name"], "get_weather");
    }

    #[test]
    fn test_kind_to_json_type() {
        assert_eq!(kind_to_json_type("string"), "string");
        assert_eq!(kind_to_json_type("integer"), "integer");
        assert_eq!(kind_to_json_type("float"), "number");
        assert_eq!(kind_to_json_type("number"), "number");
        assert_eq!(kind_to_json_type("boolean"), "boolean");
        assert_eq!(kind_to_json_type("array"), "array");
        assert_eq!(kind_to_json_type("object"), "object");
    }

    #[test]
    fn test_mime_to_audio() {
        assert_eq!(mime_to_audio_format("audio/wav"), "wav");
        assert_eq!(mime_to_audio_format("audio/mpeg"), "mp3");
        assert_eq!(mime_to_audio_format("audio/mp4"), "mp4");
        assert_eq!(mime_to_audio_format("audio/ogg"), "ogg");
        assert_eq!(mime_to_audio_format("audio/flac"), "flac");
        assert_eq!(mime_to_audio_format("audio/webm"), "webm");
        assert_eq!(mime_to_audio_format("audio/pcm"), "pcm");
        // Per spec §7.1.2: unmapped audio/* types strip the prefix
        assert_eq!(mime_to_audio_format("audio/aac"), "aac");
        assert_eq!(mime_to_audio_format("audio/opus"), "opus");
        // Non-audio MIME falls back to "wav"
        assert_eq!(mime_to_audio_format("text/plain"), "wav");
    }

    #[test]
    fn test_format_tool_messages() {
        let tool_calls = vec![prompty::types::ToolCall {
            id: "call_1".to_string(),
            name: "get_weather".to_string(),
            arguments: r#"{"city":"SF"}"#.to_string(),
        }];
        let results = vec![prompty::ToolResult::from_text("72°F")];
        let msgs = format_tool_messages(&tool_calls, &results);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role.to_string(), "assistant");
        assert!(msgs[0].metadata.contains_key("tool_calls"));
        assert_eq!(msgs[1].role.to_string(), "tool");
        assert_eq!(msgs[1].text_content(), "72°F");
    }
}
