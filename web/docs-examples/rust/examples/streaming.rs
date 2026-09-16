use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    prompty::register_defaults();
    prompty_openai::register();

    // Load agent and prepare messages
    let agent = prompty::load("chat.prompty")?;
    let messages = prompty::prepare(&agent, Some(&json!({ "question": "Tell me a joke" }))).await?;

    // When stream: true is set, run consumes the stream and returns accumulated text
    let result = prompty::run(&agent, &messages).await?;

    println!("{result}");
    Ok(())
}
