use prompty::StreamChunk;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    prompty::register_defaults();
    prompty_openai::register();

    // Load agent and prepare messages
    let agent = prompty::load("chat.prompty")?;
    let messages = prompty::prepare(&agent, Some(&json!({ "question": "Tell me a joke" }))).await?;

    // Run returns a PromptyStream when stream: true is set
    let result = prompty::run(&agent, &messages).await?;

    // Process streaming chunks
    let stream = prompty::from_structured_value::<prompty::PromptyStream>(&result)?;
    prompty::consume_stream_chunks(stream, |chunk| match chunk {
        StreamChunk::Text(text) => print!("{text}"),
        StreamChunk::Thinking(thought) => print!("[thinking] {thought}"),
        StreamChunk::Tool(tc) => println!("[tool call] {}: {}", tc.name, tc.arguments),
        StreamChunk::Error(err) => eprintln!("[error] {}", err.message()),
    })
    .await;

    println!();
    Ok(())
}
