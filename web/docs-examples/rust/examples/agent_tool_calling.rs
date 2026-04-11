use prompty::TurnOptions;
use serde_json::json;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    prompty::register_defaults();
    prompty_openai::register();

    // Register tool handlers
    prompty::register_tool_handler("get_weather", |args| {
        Box::pin(async move {
            let city = args["city"].as_str().unwrap_or("unknown");
            Ok(json!(format!("72°F and sunny in {city}")))
        })
    });

    prompty::register_tool_handler("get_time", |args| {
        Box::pin(async move {
            let timezone = args["timezone"].as_str().unwrap_or("UTC");
            Ok(json!(format!("2025-01-15T10:30:00 {timezone}")))
        })
    });

    // Load agent and run with tool-calling loop
    let agent = prompty::load("weather_agent.prompty")?;

    let options = TurnOptions {
        max_iterations: Some(10),
        events: Some(Arc::new(|event| {
            println!("Agent event: {event:?}");
        })),
        ..Default::default()
    };

    let result = prompty::turn(
        &agent,
        Some(&json!({ "question": "What's the weather in Seattle?" })),
        Some(options),
    )
    .await?;

    println!("Result: {result}");
    Ok(())
}
