using Azure.AI.OpenAI;

namespace Prompty.Core
{
    public class BaseModel
    {
        public string Prompt { get; set; }
        public List<Dictionary<string, string>> Messages { get; set; }
        public ChatResponseMessage ChatResponseMessage { get; set; }
        public Completions CompletionResponseMessage { get; set; }
        public Embeddings EmbeddingResponseMessage { get; set; }
        public ImageGenerations ImageResponseMessage { get; set; }
    }
}
