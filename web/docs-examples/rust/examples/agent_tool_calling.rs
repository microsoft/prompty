use prompty::{AgentEvent, TurnOptions};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    prompty::register_defaults();
    prompty_openai::register();

    // Register tool handlers
    prompty::register_tool("get_weather", |args: serde_json::Value| {
        Box::pin(async move {
            let city = args["city"].as_str().unwrap_or("unknown");
            Ok(format!("72°F and sunny in {city}"))
        })
    });

    prompty::register_tool("get_time", |args: serde_json::Value| {
        Box::pin(async move {
            let timezone = args["timezone"].as_str().unwrap_or("UTC");
            Ok(format!("2025-01-15T10:30:00 {timezone}"))
        })
    });

    // Load agent and run with tool-calling loop
    let agent = prompty::load("weather_agent.prompty")?;

    let options = TurnOptions::builder()
        .max_iterations(10)
        .on_event(Box::new(|event| {
            if let AgentEvent::Status(message) = event {
                println!("Agent status: {message}");
            }
        }))
        .build();

    let result = prompty::turn(
        &agent,
        Some(&json!({ "question": "What's the weather in Seattle?" })),
        Some(options),
    )
    .await?;

    println!("Result: {result}");
    Ok(())
}
