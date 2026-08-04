// Copyright (c) Microsoft. All rights reserved.

// --- Runtime helpers (manually maintained) ---
// These extend generated Model/pipeline types with small convenience members the
// canonical turn engine needs. They mirror the `impl` blocks the Rust reference adds
// directly on its generated types (see runtime/rust/prompty/src/engine/ports.rs and
// model_ext.rs). New files only — no generated file under Model/ is modified.

using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Prompty.Core;

public partial class Message
{
    /// <summary>
    /// Build the message a host appends to the conversation for one tool result: a
    /// <see cref="Role.Tool"/> message whose text is the result's model-visible output,
    /// tagged with the originating tool request id so it can be located again (for
    /// example, when resuming after an indeterminate tool-effect reconciliation).
    /// </summary>
    public static Message ToolResult(string requestId, string text) => new()
    {
        Role = Role.Tool,
        Parts = [new TextPart { Value = text }],
        Metadata = new Dictionary<string, object?> { ["tool_call_id"] = requestId },
    };
}

public partial class ModelToolResult
{
    /// <summary>
    /// Render this tool result's output as model-visible text, tolerating an absent output.
    /// A plain string output is used as-is; any other JSON-ish value is stringified.
    /// </summary>
    public string ModelText() => Output switch
    {
        null => string.Empty,
        string text => text,
        var value => SerializeCanonicalJson(value),
    };

    private static string SerializeCanonicalJson(object value)
    {
        var element = JsonSerializer.SerializeToElement(value);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(
            stream,
            new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            WriteCanonicalJson(writer, element);
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteCanonicalJson(Utf8JsonWriter writer, JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in element.EnumerateObject().OrderBy(property => property.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonicalJson(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray())
                {
                    WriteCanonicalJson(writer, item);
                }
                writer.WriteEndArray();
                break;
            default:
                element.WriteTo(writer);
                break;
        }
    }
}

public partial class ResumeContext
{
    /// <summary>
    /// The journal sequence a resumed run must continue after: the larger of the
    /// recorded journal tail and the checkpoint's own last committed sequence.
    /// </summary>
    public long ResumeSequence() => Math.Max(LastJournalSequence, Checkpoint.LastSequence);
}
