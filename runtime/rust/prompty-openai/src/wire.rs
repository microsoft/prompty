//! Wire format conversion for the OpenAI Chat Completions API.
//!
//! Converts Prompty `Message`s, tools, options, and output schemas into the
//! JSON bodies expected by the OpenAI API.

use prompty::model::{
    MessageHelpers, ModelOptions, Prompty, Property, PropertyKind, Tool, ToolKind,
};
use prompty::types::{ContentPart, ContentPartKind, Message};
use serde_json::{Map, Value, json};

// ---------------------------------------------------------------------------
// Message → OpenAI wire format
// ---------------------------------------------------------------------------

/// Convert a `Message` to the OpenAI wire format.
pub fn message_to_wire(msg: &Message) -> Value {
    let mut obj = Map::new();
    obj.insert("role".to_string(), Value::String(msg.role.to_string()));

    // Copy metadata fields (tool_call_id, tool_calls, name, etc.)
    if let Some(meta_map) = msg.metadata.as_object() {
        for (k, v) in meta_map {
            if k != "role" && k != "content" {
                obj.insert(k.clone(), v.clone());
            }
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
    match &part.kind {
        ContentPartKind::TextPart { value, .. } => json!({
            "type": "text",
            "text": value,
        }),
        ContentPartKind::ImagePart { source, detail, .. } => {
            let mut img = Map::new();
            img.insert("url".to_string(), Value::String(source.clone()));
            if let Some(detail) = detail {
                img.insert("detail".to_string(), Value::String(detail.clone()));
            }
            json!({
                "type": "image_url",
                "image_url": Value::Object(img),
            })
        }
        ContentPartKind::AudioPart {
            source, media_type, ..
        } => {
            let format = media_type
                .as_deref()
                .map(mime_to_audio_format)
                .unwrap_or_else(|| "wav".to_string());
            json!({
                "type": "input_audio",
                "input_audio": {
                    "data": source,
                    "format": format,
                },
            })
        }
        ContentPartKind::FilePart { source, .. } => json!({
            "type": "file",
            "file": { "url": source },
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

fn apply_options(args: &mut Map<String, Value>, opts: &Option<ModelOptions>) {
    let Some(opts) = opts else { return };

    let wire = opts.to_wire("openai");
    if let Value::Object(map) = wire {
        for (k, v) in map {
            if !v.is_null() {
                args.insert(k, fix_f32_value(v));
            }
        }
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
    let Some(tools) = agent.as_tools() else {
        return Vec::new();
    };

    tools
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
    let bound_names: std::collections::HashSet<String> =
        tool.bindings.iter().map(|b| b.name.clone()).collect();

    // Parameters → JSON Schema, filtering out bound params
    {
        let typed_params: Vec<&Property> = parameters
            .iter()
            .filter(|p| !bound_names.contains(&p.name))
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
    if let Some(json_type) = kind_to_json_type(prop.kind_str()) {
        schema.insert("type".to_string(), Value::String(json_type.to_string()));
    }

    if let Some(ref desc) = prop.description {
        schema.insert("description".to_string(), Value::String(desc.clone()));
    }
    if let Some(ref enum_vals) = prop.enum_values {
        schema.insert("enum".to_string(), Value::Array(enum_vals.clone()));
    }

    match &prop.kind {
        PropertyKind::Array { items } if !items.is_null() => {
            let ctx = prompty::model::context::LoadContext::default();
            let item_prop = Property::load_from_value(items, &ctx);
            schema.insert("items".to_string(), property_to_json_schema(&item_prop));
        }
        PropertyKind::Array { .. } => {
            // bare {"type": "array"} when items is null/unspecified
        }
        PropertyKind::Object { properties } if !properties.is_empty() => {
            let mut nested = Map::new();
            let mut req = Vec::new();
            for p in properties {
                if p.name.is_empty() {
                    continue;
                }
                nested.insert(p.name.clone(), property_to_json_schema(p));
                if p.required.unwrap_or(false) {
                    req.push(Value::String(p.name.clone()));
                }
            }
            schema.insert("properties".to_string(), Value::Object(nested));
            if !req.is_empty() {
                schema.insert("required".to_string(), Value::Array(req));
            }
            schema.insert("additionalProperties".to_string(), Value::Bool(false));
        }
        PropertyKind::Object { .. } => {
            // bare {"type": "object"} when properties is empty or absent
        }
        PropertyKind::Union { one_of, any_of } => {
            if !one_of.is_empty() {
                schema.insert(
                    "oneOf".to_string(),
                    Value::Array(one_of.iter().map(property_to_json_schema).collect()),
                );
            }
            if !any_of.is_empty() {
                schema.insert(
                    "anyOf".to_string(),
                    Value::Array(any_of.iter().map(property_to_json_schema).collect()),
                );
            }
        }
        _ => {}
    }

    if prop.nullable.unwrap_or(false) {
        add_nullability(&mut schema);
    }

    Value::Object(schema)
}

fn add_nullability(schema: &mut Map<String, Value>) {
    if let Some(Value::String(json_type)) = schema.remove("type") {
        schema.insert(
            "type".to_string(),
            Value::Array(vec![
                Value::String(json_type),
                Value::String("null".to_string()),
            ]),
        );
    } else if let Some(Value::Array(branches)) = schema.get_mut("anyOf") {
        branches.push(json!({ "type": "null" }));
    } else if let Some(Value::Array(branches)) = schema.get_mut("oneOf") {
        branches.push(json!({ "type": "null" }));
    } else {
        schema.insert("type".to_string(), Value::String("null".to_string()));
    }
}

fn parameters_to_json_schema(params: &[&Property]) -> Value {
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

fn kind_to_json_type(kind: &str) -> Option<&'static str> {
    match kind {
        "string" => Some("string"),
        "integer" => Some("integer"),
        "float" | "number" => Some("number"),
        "boolean" => Some("boolean"),
        "array" => Some("array"),
        "object" => Some("object"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Structured output (outputs → response_format)
// ---------------------------------------------------------------------------

fn output_schema_to_wire(agent: &Prompty) -> Option<Value> {
    let outputs = agent.as_outputs()?;
    if outputs.is_empty() {
        return None;
    }

    let mut properties = Map::new();
    let mut required = Vec::new();

    for prop in outputs {
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

/// Return whether a durable message holds a provider-owned Responses function-call item.
///
/// Native `previous_response_id` continuation already owns this item; its delta
/// must carry only the following function-call output and later caller input.
pub fn is_responses_function_call(msg: &Message) -> bool {
    msg.metadata.get("responses_function_call").is_some()
}

fn apply_responses_options(args: &mut Map<String, Value>, opts: &Option<ModelOptions>) {
    let Some(opts) = opts else { return };

    let wire = opts.to_wire("responses");
    if let Value::Object(map) = wire {
        for (k, v) in map {
            if !v.is_null() {
                args.insert(k, fix_f32_value(v));
            }
        }
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
    let Some(tools) = agent.as_tools() else {
        return Vec::new();
    };

    tools
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
    let bound_names: std::collections::HashSet<String> =
        tool.bindings.iter().map(|b| b.name.clone()).collect();

    {
        let typed_params: Vec<&Property> = parameters
            .iter()
            .filter(|p| !bound_names.contains(&p.name))
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
    let outputs = agent.as_outputs()?;
    if outputs.is_empty() {
        return None;
    }

    let mut properties = Map::new();
    let mut required = Vec::new();

    for prop in outputs {
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
/// `tool` role message per result.
pub fn format_tool_messages(
    tool_calls: &[prompty::types::ToolCall],
    results: &[String],
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

    let mut assistant = Message::with_text(prompty::Role::Assistant, "");
    assistant
        .metadata_mut()
        .insert("tool_calls".to_string(), Value::Array(wire_calls));
    messages.push(assistant);

    // One tool result message per call
    for (tc, result) in tool_calls.iter().zip(results) {
        let mut msg = Message::tool_result(&tc.id, result);
        msg.metadata_mut()
            .insert("name".to_string(), Value::String(tc.name.clone()));
        messages.push(msg);
    }

    messages
}

/// Format a Responses API tool exchange while preserving original function-call items.
pub fn format_responses_tool_messages(
    raw_response: &Value,
    tool_calls: &[prompty::types::ToolCall],
    results: &[String],
) -> Vec<Message> {
    let originals = raw_response
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
        .filter(|item| {
            item.get("call_id")
                .and_then(Value::as_str)
                .is_some_and(|call_id| tool_calls.iter().any(|call| call.id == call_id))
        })
        .cloned()
        .collect::<Vec<_>>();

    format_responses_tool_exchange(originals, tool_calls, results)
}

/// Format a streamed Responses API tool exchange from raw response events.
pub fn format_stream_responses_tool_messages(
    raw_chunks: &[Value],
    tool_calls: &[prompty::types::ToolCall],
    results: &[String],
) -> Vec<Message> {
    use std::collections::BTreeMap;

    let mut originals = BTreeMap::<usize, Value>::new();
    for chunk in raw_chunks {
        let event_type = chunk.get("type").and_then(Value::as_str);
        if event_type == Some("response.completed") {
            if let Some(output) = chunk
                .get("response")
                .and_then(|response| response.get("output"))
                .and_then(Value::as_array)
            {
                for (index, item) in output.iter().enumerate() {
                    if item.get("type").and_then(Value::as_str) == Some("function_call") {
                        originals.insert(index, item.clone());
                    }
                }
            }
        }
        if matches!(
            event_type,
            Some("response.output_item.added" | "response.output_item.done")
        ) {
            if let Some(item) = chunk.get("item") {
                if item.get("type").and_then(Value::as_str) == Some("function_call") {
                    let index = chunk
                        .get("output_index")
                        .and_then(Value::as_u64)
                        .unwrap_or(originals.len() as u64) as usize;
                    originals.insert(index, item.clone());
                }
            }
        }
        if event_type == Some("response.function_call_arguments.done") {
            if let Some(call_id) = chunk.get("call_id").and_then(Value::as_str) {
                if let Some(arguments) = chunk.get("arguments").and_then(Value::as_str) {
                    if let Some(item) = originals
                        .values_mut()
                        .find(|item| item.get("call_id").and_then(Value::as_str) == Some(call_id))
                    {
                        item["arguments"] = Value::String(arguments.to_string());
                    }
                }
            }
        }
    }

    format_responses_tool_exchange(originals.into_values().collect(), tool_calls, results)
}

fn format_responses_tool_exchange(
    originals: Vec<Value>,
    tool_calls: &[prompty::types::ToolCall],
    results: &[String],
) -> Vec<Message> {
    let mut messages = Vec::new();
    for tool_call in tool_calls {
        let original = originals
            .iter()
            .find(|item| item.get("call_id").and_then(Value::as_str) == Some(tool_call.id.as_str()))
            .cloned()
            .unwrap_or_else(|| {
                json!({
                    "type": "function_call",
                    "call_id": tool_call.id,
                    "name": tool_call.name,
                    "arguments": tool_call.arguments,
                })
            });
        let mut message = Message::with_text(prompty::Role::Assistant, "");
        message
            .metadata_mut()
            .insert("responses_function_call".to_string(), original);
        messages.push(message);
    }
    for (tool_call, result) in tool_calls.iter().zip(results) {
        messages.push(Message::tool_result(&tool_call.id, result));
    }
    messages
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_to_wire_text() {
        let msg = Message::with_text(prompty::Role::User, "Hello");
        let wire = message_to_wire(&msg);
        assert_eq!(wire["role"], "user");
        assert_eq!(wire["content"], "Hello");
    }

    #[test]
    fn test_message_to_wire_multipart() {
        let msg = Message {
            role: prompty::Role::User,
            parts: vec![
                ContentPart::text("Describe"),
                ContentPart::image("https://img.png", None, None),
            ],
            ..Default::default()
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
            parts: vec![ContentPart::audio(
                "base64data",
                Some("audio/mpeg".to_string()),
            )],
            ..Default::default()
        };
        let wire = message_to_wire(&msg);
        let content = wire["content"].as_array().unwrap();
        assert_eq!(content[0]["type"], "input_audio");
        assert_eq!(content[0]["input_audio"]["format"], "mp3");
    }

    #[test]
    fn test_message_to_wire_metadata() {
        let mut msg = Message::with_text(prompty::Role::Tool, "result");
        msg.metadata_mut()
            .insert("tool_call_id".to_string(), json!("call_123"));
        msg.metadata_mut()
            .insert("name".to_string(), json!("get_weather"));
        let wire = message_to_wire(&msg);
        assert_eq!(wire["tool_call_id"], "call_123");
        assert_eq!(wire["name"], "get_weather");
    }

    #[test]
    fn test_kind_to_json_type() {
        assert_eq!(kind_to_json_type("string"), Some("string"));
        assert_eq!(kind_to_json_type("integer"), Some("integer"));
        assert_eq!(kind_to_json_type("float"), Some("number"));
        assert_eq!(kind_to_json_type("number"), Some("number"));
        assert_eq!(kind_to_json_type("boolean"), Some("boolean"));
        assert_eq!(kind_to_json_type("array"), Some("array"));
        assert_eq!(kind_to_json_type("object"), Some("object"));
        assert_eq!(kind_to_json_type("union"), None);
        assert_eq!(kind_to_json_type(""), None);
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
        let results = vec!["72°F".to_string()];
        let msgs = format_tool_messages(&tool_calls, &results);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role.to_string(), "assistant");
        assert!(msgs[0].metadata.get("tool_calls").is_some());
        assert_eq!(msgs[1].role.to_string(), "tool");
        assert_eq!(msgs[1].text_content(), "72°F");
    }

    #[test]
    fn test_format_multiple_tool_messages_preserves_request_order() {
        let tool_calls = vec![
            prompty::types::ToolCall {
                id: "call_1".to_string(),
                name: "first".to_string(),
                arguments: "{}".to_string(),
            },
            prompty::types::ToolCall {
                id: "call_2".to_string(),
                name: "second".to_string(),
                arguments: "{}".to_string(),
            },
        ];

        let messages = format_tool_messages(&tool_calls, &["one".to_string(), "two".to_string()]);

        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1].metadata["tool_call_id"], "call_1");
        assert_eq!(messages[1].text_content(), "one");
        assert_eq!(messages[2].metadata["tool_call_id"], "call_2");
        assert_eq!(messages[2].text_content(), "two");
    }

    #[test]
    fn test_responses_tool_messages_preserve_original_calls_before_outputs() {
        let raw_response = json!({
            "object": "response",
            "output": [
                {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_1",
                    "name": "first",
                    "arguments": "{\"value\":1}",
                    "status": "completed"
                },
                {
                    "type": "function_call",
                    "id": "fc_2",
                    "call_id": "call_2",
                    "name": "second",
                    "arguments": "{\"value\":2}",
                    "status": "completed"
                }
            ]
        });
        let calls = vec![
            prompty::types::ToolCall {
                id: "call_1".to_string(),
                name: "first".to_string(),
                arguments: "{\"value\":1}".to_string(),
            },
            prompty::types::ToolCall {
                id: "call_2".to_string(),
                name: "second".to_string(),
                arguments: "{\"value\":2}".to_string(),
            },
        ];

        let messages =
            format_responses_tool_messages(&raw_response, &calls, &["one".into(), "two".into()]);

        assert_eq!(messages.len(), 4);
        assert_eq!(
            messages[0].metadata["responses_function_call"]["id"],
            "fc_1"
        );
        assert_eq!(
            messages[1].metadata["responses_function_call"]["status"],
            "completed"
        );
        assert_eq!(messages[2].metadata["tool_call_id"], "call_1");
        assert_eq!(messages[3].metadata["tool_call_id"], "call_2");
    }

    #[test]
    fn test_responses_tool_messages_round_trip_to_function_call_items() {
        let agent = Prompty::load_from_value(
            &json!({
                "name": "responses",
                "kind": "prompt",
                "model": {"id": "gpt-4o", "provider": "openai", "apiType": "responses"},
                "instructions": "test"
            }),
            &prompty::model::context::LoadContext::default(),
        );
        let calls = vec![prompty::types::ToolCall {
            id: "call_1".to_string(),
            name: "lookup".to_string(),
            arguments: "{}".to_string(),
        }];
        let mut messages = vec![Message::with_text(prompty::Role::User, "run")];
        messages.extend(format_responses_tool_messages(
            &json!({
                "object": "response",
                "output": [{
                    "type": "function_call",
                    "id": "fc_original",
                    "call_id": "call_1",
                    "name": "lookup",
                    "arguments": "{}",
                    "status": "completed"
                }]
            }),
            &calls,
            &["result".to_string()],
        ));

        let input = build_responses_args(&agent, &messages)["input"]
            .as_array()
            .unwrap()
            .clone();

        assert_eq!(input[1]["type"], "function_call");
        assert_eq!(input[1]["id"], "fc_original");
        assert_eq!(input[2]["type"], "function_call_output");
        assert_eq!(input[2]["call_id"], "call_1");
        assert_eq!(input[2]["output"], "result");
    }

    #[test]
    fn test_stream_responses_tool_messages_preserve_done_item_and_arguments() {
        let calls = vec![prompty::types::ToolCall {
            id: "call_stream".to_string(),
            name: "lookup".to_string(),
            arguments: "{\"q\":\"rust\"}".to_string(),
        }];
        let chunks = vec![
            json!({
                "type": "response.output_item.added",
                "output_index": 0,
                "item": {
                    "type": "function_call",
                    "id": "fc_stream",
                    "call_id": "call_stream",
                    "name": "lookup",
                    "arguments": ""
                }
            }),
            json!({
                "type": "response.function_call_arguments.done",
                "call_id": "call_stream",
                "arguments": "{\"q\":\"rust\"}"
            }),
            json!({
                "type": "response.output_item.done",
                "output_index": 0,
                "item": {
                    "type": "function_call",
                    "id": "fc_stream",
                    "call_id": "call_stream",
                    "name": "lookup",
                    "arguments": "{\"q\":\"rust\"}",
                    "status": "completed"
                }
            }),
        ];

        let messages =
            format_stream_responses_tool_messages(&chunks, &calls, &["found".to_string()]);

        let original = &messages[0].metadata["responses_function_call"];
        assert_eq!(original["id"], "fc_stream");
        assert_eq!(original["arguments"], "{\"q\":\"rust\"}");
        assert_eq!(original["status"], "completed");
        assert_eq!(messages[1].metadata["tool_call_id"], "call_stream");
    }
}
