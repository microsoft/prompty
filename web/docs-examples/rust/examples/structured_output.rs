use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    prompty::register_defaults();
    prompty_openai::register();

    // Load a .prompty file with outputSchema defined
    let agent = prompty::load("structured.prompty")?;

    let result = prompty::invoke_agent(
        &agent,
        Some(&json!({ "topic": "Rust programming language" })),
    )
    .await?;

    // result is a parsed JSON object matching the outputSchema
    println!("Title: {}", result["title"]);
    println!("Summary: {}", result["summary"]);
    println!("Tags: {}", result["tags"]);

    Ok(())
}
