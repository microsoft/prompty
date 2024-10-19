using Microsoft.Extensions.AI;
using System.Text.RegularExpressions;

namespace Prompty.Core.Parsers
{
    [Parser("prompty.chat")]
    public class PromptyChatParser : Invoker
    {
        private static readonly string[] _roles = ["assistant", "function", "tool", "system", "user"];
        private static readonly string _messageRegex = @"^\s*#?\s*(" + string.Join("|", _roles) + @")\s*:\s*$";
        private static readonly string _imageRegex = @"(?<alt>!\[[^\]]*\])\((?<filename>.*?)(?=\""|\))\)";

        public PromptyChatParser(Prompty prompty) : base(prompty) { }

        public override object Invoke(object args)
        {
            if (args.GetType() != typeof(string))
                throw new Exception("Invalid args type for prompty.chat");
            ChatMessage[] messages = Parse((string)args, true).GetAwaiter().GetResult();
            return messages;
        }

        public async override Task<object> InvokeAsync(object args)
        {
            if (args.GetType() != typeof(string))
                throw new Exception("Invalid args type for prompty.chat");
            ChatMessage[] messages = await Parse((string)args, false);
            return messages;
        }

        private ChatRole ToChatRole(string role)
        {
            switch (role)
            {
                case "assistant":
                    return ChatRole.Assistant;
                case "function":
                    return ChatRole.Tool;
                case "tool":
                    return ChatRole.Tool;
                case "system":
                    return ChatRole.System;
                case "user":
                    return ChatRole.User;

                default:
                    throw new Exception("Invalid role!");
            }
        }

        private async Task<ChatMessage[]> Parse(string template, bool sync)
        {
            var chunks = Regex.Split(template, _messageRegex, RegexOptions.Multiline)
                                .Where(s => s.Trim().Length > 0)
                                .Select(s => s.Trim())
                                .ToList();

            // if no starter role, assume system
            if (chunks[0].Trim().ToLower() != "system")
                chunks.Insert(0, "system");

            // if last chunk is role then content is empty
            if (_roles.Contains(chunks[chunks.Count - 1].Trim().ToLower()))
                chunks.RemoveAt(chunks.Count - 1);

            if (chunks.Count % 2 != 0)
                throw new Exception("Invalid prompt format!");

            List<ChatMessage> messages = [];
            for (int i = 0; i < chunks.Count; i += 2)
            {
                // check for embedded images
                var imageMatches = Regex.Matches(chunks[i + 1], _imageRegex, RegexOptions.Multiline);
                if (imageMatches.Count > 0)
                {
                    var c = await GetContent(imageMatches, chunks[i + 1], sync);
                    messages.Add(new ChatMessage(ToChatRole(chunks[i]), c));
                }
                else
                    messages.Add(new ChatMessage(ToChatRole(chunks[i]), chunks[i + 1]));
            }


            return [.. messages];
        }

        private async Task<IList<AIContent>> GetContent(MatchCollection matches, string content, bool sync)
        {
            List<AIContent> contents = [];
            var content_chunks = Regex.Split(content, _imageRegex, RegexOptions.Multiline)
                                .Where(s => s.Trim().Length > 0)
                                .Select(s => s.Trim())
                                .ToList();

            int current_chunk = 0;
            for (int i = 0; i < content_chunks.Count; i++)
            {
                // alt entry
                if (current_chunk < matches.Count && content_chunks[i] == matches[current_chunk].Groups["alt"].Value)
                {
                    continue;
                }
                // image entry
                else if (current_chunk < matches.Count && content_chunks[i] == matches[current_chunk].Groups["filename"].Value)
                {
                    var img = matches[current_chunk].Groups[2].Value.Split(" ")[0].Trim();
                    var media = img.Split(".").Last().Trim().ToLower();
                    if (media != "jpg" && media != "jpeg" && media != "png")
                        throw new Exception("Invalid image media type (jpg, jpeg, or png are allowed)");

                    if(img.StartsWith("http://") || img.StartsWith("https://"))
                    {
                        contents.Add(new ImageContent(img, $"image/{media}"));
                    }
                    else
                    {
                        var basePath = Path.GetDirectoryName(_prompty.Path);
                        var path = basePath != null ? Path.GetFullPath(img, basePath) : Path.GetFullPath(img);
                        // load image from file into ReadOnlyMemory<byte>
                        if (sync)
                        {
                            var bytes = File.ReadAllBytes(path);
                            contents.Add(new ImageContent(bytes, $"image/{media}"));
                        }
                        else
                        {
                            var bytes = await File.ReadAllBytesAsync(path);
                            contents.Add(new ImageContent(bytes, $"image/{media}"));
                        }

                    }
                    current_chunk += 1;
                }
                // text entry
                else
                {
                    var text = content_chunks[i].Trim();
                    if(text.Length > 0)
                        contents.Add(new TextContent(text));
                }

            }

            return contents;
        }
    }
}
