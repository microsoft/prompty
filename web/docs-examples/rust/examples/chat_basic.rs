use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Register built-in renderers/parsers and OpenAI provider
    prompty::register_defaults();
    prompty_openai::register();

    // All-in-one: load → render → parse → execute → process
    let result = prompty::invoke_from_path(
        "greeting.prompty",
        Some(&json!({ "userName": "Jane" })),
    )
    .await?;

    println!("{result}");
    // "Hello Jane! 👋 How's your day going so far?"

    Ok(())
}
