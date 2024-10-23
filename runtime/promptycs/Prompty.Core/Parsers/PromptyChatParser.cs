using Microsoft.Extensions.AI;
using Microsoft.Extensions.FileSystemGlobbing;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using static System.Net.Mime.MediaTypeNames;

namespace Prompty.Core.Parsers
{
    enum ContentType
    {
        Text,
        LocalImage,
        RemoteImage
    }

    struct RawMessage
    {
        public ChatRole Role { get; set; }
        public string? Content { get; set; }
        public IEnumerable<RawContent> Contents { get; set; }
    }

    struct RawContent
    {
        public ContentType ContentType { get; set; }
        public string Content { get; set; }
        public string Media { get; set; }
    }

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

            var messages = Parse((string)args).Select(m =>
            {
                if (string.IsNullOrEmpty(m.Content) && m.Contents != null)
                {
                    var contents = m.Contents.Select<RawContent, AIContent>(c =>
                    {
                        switch (c.ContentType)
                        {
                            case ContentType.Text:
                                return new TextContent(c.Content);
                            case ContentType.LocalImage:
                                var image = GetImageContent(c.Content, c.Media);
                                return new ImageContent(image, c.Media);
                            case ContentType.RemoteImage:
                                return new ImageContent(c.Content, c.Media);
                            default:
                                throw new Exception("Invalid content type!");
                        }
                    }).ToList();

                    return new ChatMessage(m.Role, contents);
                }
                else
                {
                    return new ChatMessage(m.Role, m.Content);
                }
            }).ToArray();


            return messages;

        }

        public async override Task<object> InvokeAsync(object args)
        {
            if (args.GetType() != typeof(string))
                throw new Exception("Invalid args type for prompty.chat");

            var messageTask = Parse((string)args).Select(async m =>
            {
                if (string.IsNullOrEmpty(m.Content) && m.Contents != null)
                {
                    var task = m.Contents.Select<RawContent, Task<AIContent>>(async c =>
                    {
                        switch (c.ContentType)
                        {
                            case ContentType.Text:
                                return new TextContent(c.Content);
                            case ContentType.LocalImage:
                                var image = await GetImageContentAsync(c.Content, c.Media);
                                return new ImageContent(image, c.Media);
                            case ContentType.RemoteImage:
                                return new ImageContent(c.Content, c.Media);
                            default:
                                throw new Exception("Invalid content type!");
                        }
                    });

                    var results = await Task.WhenAll(task);

                    return new ChatMessage(m.Role, [.. results]);
                }
                else
                {
                    return new ChatMessage(m.Role, m.Content);
                }
            });

            var messages = await Task.WhenAll(messageTask);
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

        private IEnumerable<RawMessage> Parse(string template)
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
                var matches = Regex.Matches(chunks[i + 1], _imageRegex, RegexOptions.Multiline);
                if (matches.Count > 0)
                    yield return new RawMessage { Role = ToChatRole(chunks[i]), Contents = Processs(matches, chunks[i + 1]) };
                else
                    yield return new RawMessage { Role = ToChatRole(chunks[i]), Content = chunks[i + 1] };
            }
        }

        private IEnumerable<RawContent> Processs(MatchCollection matches, string content)
        {

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

                    if (img.StartsWith("http://") || img.StartsWith("https://"))
                        yield return new RawContent { ContentType = ContentType.RemoteImage, Content = img, Media = $"image/{media}" };
                    else
                        yield return new RawContent { ContentType = ContentType.LocalImage, Content = img, Media = $"image/{media}" };
                    current_chunk += 1;
                }
                // text entry
                else
                {
                    var text = content_chunks[i].Trim();
                    if (text.Length > 0)
                        yield return new RawContent { ContentType = ContentType.Text, Content = text };
                }

            }
        }

        private byte[]? GetImageContent(string image, string media)
        {
            var basePath = Path.GetDirectoryName(_prompty.Path);
            var path = basePath != null ? Path.GetFullPath(image, basePath) : Path.GetFullPath(image);
            var bytes = File.ReadAllBytes(path);
            return bytes;
        }

        private async Task<byte[]?> GetImageContentAsync(string image, string media)
        {
            var basePath = Path.GetDirectoryName(_prompty.Path);
            var path = basePath != null ? Path.GetFullPath(image, basePath) : Path.GetFullPath(image);
            var bytes = await File.ReadAllBytesAsync(path);
            return bytes;
        }
    }
}
