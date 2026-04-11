//! Structured output — `StructuredResult` + `cast::<T>()`.
//!
//! Matches TypeScript `core/structured.ts`. When a prompt has an `outputSchema`,
//! the processor wraps the parsed result in a `StructuredResult` that carries
//! both the typed data and the raw JSON string. `cast::<T>()` deserializes
//! with an optional validator.
//!
//! In TypeScript, the raw JSON is stored as a non-enumerable Symbol property,
//! making the object look like plain data. In Rust, we use a transport format
//! with a `__prompty_structured` marker that `is_structured_result()` checks.
//! The `data` field contains the actual parsed value.

use serde_json::Value;

// ---------------------------------------------------------------------------
// StructuredResult
// ---------------------------------------------------------------------------

/// A structured output result that carries both the parsed JSON value
/// and the original raw JSON string from the LLM.
///
/// Matches TypeScript's `StructuredResult` (backed by a Symbol property).
#[derive(Debug, Clone)]
pub struct StructuredResult {
    /// The parsed JSON data.
    pub data: Value,
    /// The original raw JSON string from the LLM response.
    pub raw_json: String,
}

/// Create a new `StructuredResult`.
pub fn create_structured_result(data: Value, raw_json: String) -> StructuredResult {
    StructuredResult { data, raw_json }
}

/// Check if a `serde_json::Value` is a serialized `StructuredResult`.
///
/// We store structured results as JSON objects with a `__prompty_structured` marker.
pub fn is_structured_result(value: &Value) -> bool {
    value
        .as_object()
        .map(|o| o.contains_key("__prompty_structured"))
        .unwrap_or(false)
}

/// Serialize a `StructuredResult` to a `Value` for pipeline transport.
///
/// The result is a JSON object with `__prompty_structured: true`, `data`, and `raw_json`.
pub fn to_structured_value(result: &StructuredResult) -> Value {
    serde_json::json!({
        "__prompty_structured": true,
        "data": result.data,
        "raw_json": result.raw_json,
    })
}

/// Reconstruct a `StructuredResult` from a pipeline `Value`.
pub fn from_structured_value(value: &Value) -> Option<StructuredResult> {
    if !is_structured_result(value) {
        return None;
    }
    let obj = value.as_object()?;
    let data = obj.get("data")?.clone();
    let raw_json = obj.get("raw_json")?.as_str()?.to_string();
    Some(StructuredResult { data, raw_json })
}

/// Unwrap a StructuredResult to just its data, or return the value as-is.
///
/// This is used by the pipeline to return clean data to the user while
/// preserving StructuredResult transport for `cast()`.
pub fn unwrap_structured(value: &Value) -> Value {
    if let Some(sr) = from_structured_value(value) {
        sr.data
    } else {
        value.clone()
    }
}

// ---------------------------------------------------------------------------
// cast
// ---------------------------------------------------------------------------

/// Deserialize a value to the target type `T`.
///
/// Accepts:
/// - A `StructuredResult` pipeline value (uses raw_json for lossless deserialization)
/// - A string value (parses directly)
/// - Any other value (JSON-stringifies, then parses)
///
/// Optionally runs a `validator` function on the deserialized result.
///
/// Matches TypeScript's `cast<T>(result, validator?)`.
#[allow(clippy::type_complexity)]
pub fn cast<T>(
    value: &Value,
    validator: Option<&dyn Fn(&T) -> Result<(), String>>,
) -> Result<T, CastError>
where
    T: serde::de::DeserializeOwned,
{
    // Try structured result first — use raw_json for lossless deserialization
    let json_str = if let Some(sr) = from_structured_value(value) {
        sr.raw_json
    } else if let Some(s) = value.as_str() {
        s.to_string()
    } else {
        serde_json::to_string(value).map_err(|e| CastError::Serialization(e.to_string()))?
    };

    let parsed: T = serde_json::from_str(&json_str).map_err(|e| CastError::Parse(e.to_string()))?;

    if let Some(v) = validator {
        v(&parsed).map_err(CastError::Validation)?;
    }

    Ok(parsed)
}

/// Errors from `cast()`.
#[derive(Debug, thiserror::Error)]
pub enum CastError {
    #[error("Failed to serialize value: {0}")]
    Serialization(String),
    #[error("Failed to parse JSON: {0}")]
    Parse(String),
    #[error("Validation failed: {0}")]
    Validation(String),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Weather {
        city: String,
        temp: f64,
    }

    #[test]
    fn test_create_structured_result() {
        let data = serde_json::json!({"city": "NY", "temp": 72.0});
        let raw = r#"{"city":"NY","temp":72.0}"#.to_string();
        let sr = create_structured_result(data.clone(), raw.clone());
        assert_eq!(sr.data, data);
        assert_eq!(sr.raw_json, raw);
    }

    #[test]
    fn test_is_structured_result() {
        let sr = serde_json::json!({
            "__prompty_structured": true,
            "data": {"city": "NY"},
            "raw_json": "{\"city\":\"NY\"}"
        });
        assert!(is_structured_result(&sr));
        assert!(!is_structured_result(&serde_json::json!({"city": "NY"})));
        assert!(!is_structured_result(&serde_json::json!("hello")));
    }

    #[test]
    fn test_to_and_from_structured_value() {
        let data = serde_json::json!({"city": "NY", "temp": 72.0});
        let raw = r#"{"city":"NY","temp":72.0}"#.to_string();
        let sr = create_structured_result(data.clone(), raw.clone());
        let val = to_structured_value(&sr);
        assert!(is_structured_result(&val));

        let recovered = from_structured_value(&val).unwrap();
        assert_eq!(recovered.data, data);
        assert_eq!(recovered.raw_json, raw);
    }

    #[test]
    fn test_cast_from_structured_result() {
        let raw = r#"{"city":"NY","temp":72.0}"#;
        let data: Value = serde_json::from_str(raw).unwrap();
        let sr = create_structured_result(data, raw.to_string());
        let val = to_structured_value(&sr);

        let weather: Weather = cast(&val, None).unwrap();
        assert_eq!(weather.city, "NY");
        assert_eq!(weather.temp, 72.0);
    }

    #[test]
    fn test_cast_from_string() {
        let val = serde_json::json!(r#"{"city":"LA","temp":85.0}"#);
        let weather: Weather = cast(&val, None).unwrap();
        assert_eq!(weather.city, "LA");
        assert_eq!(weather.temp, 85.0);
    }

    #[test]
    fn test_cast_from_object() {
        let val = serde_json::json!({"city": "SF", "temp": 65.0});
        let weather: Weather = cast(&val, None).unwrap();
        assert_eq!(weather.city, "SF");
        assert_eq!(weather.temp, 65.0);
    }

    #[test]
    fn test_cast_with_validator() {
        let val = serde_json::json!({"city": "NY", "temp": 72.0});
        let validator = |w: &Weather| {
            if w.temp > 100.0 {
                Err("Temperature too high".into())
            } else {
                Ok(())
            }
        };
        let weather: Weather = cast(&val, Some(&validator)).unwrap();
        assert_eq!(weather.city, "NY");
    }

    #[test]
    fn test_cast_with_validator_failure() {
        let val = serde_json::json!({"city": "Death Valley", "temp": 130.0});
        let validator = |w: &Weather| {
            if w.temp > 100.0 {
                Err("Temperature too high".into())
            } else {
                Ok(())
            }
        };
        let result: Result<Weather, _> = cast(&val, Some(&validator));
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CastError::Validation(_)));
    }

    #[test]
    fn test_cast_invalid_json() {
        let val = serde_json::json!("not valid json for Weather");
        let result: Result<Weather, _> = cast(&val, None);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CastError::Parse(_)));
    }

    #[test]
    fn test_from_structured_value_non_structured() {
        let val = serde_json::json!({"city": "NY"});
        assert!(from_structured_value(&val).is_none());
    }

    #[test]
    fn test_unwrap_structured_with_structured() {
        let data = serde_json::json!({"city": "NY", "temp": 72.0});
        let raw = r#"{"city":"NY","temp":72.0}"#.to_string();
        let sr = create_structured_result(data.clone(), raw);
        let val = to_structured_value(&sr);
        let unwrapped = unwrap_structured(&val);
        assert_eq!(unwrapped, data);
    }

    #[test]
    fn test_unwrap_structured_without_structured() {
        let val = serde_json::json!("Hello world");
        let unwrapped = unwrap_structured(&val);
        assert_eq!(unwrapped, val);
    }
}
