using Microsoft.Extensions.AI;
using System.Text.RegularExpressions;

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

            var messages = ParseOld((string)args).Select(m =>
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
                                return new DataContent(image, c.Media);
                            case ContentType.RemoteImage:
                                return new UriContent(c.Content, c.Media);
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

            var messageTask = ParseOld((string)args).Select(async m =>
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
                                return new DataContent(image, c.Media);
                            case ContentType.RemoteImage:
                                return new UriContent(c.Content, c.Media);
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

        private Dictionary<string, object> ParseArgs(string args)
        {
            var argPattern = @"(\w+)\s*=\s*(\""([^\""]*)\""|([Tt]rue|[Ff]alse)|([0-9]+(\.[0-9]+))|([0-9]+))\s*(,?)\s*";
            var matches = Regex.Matches(args, argPattern);

            var result = new Dictionary<string, object>();
            foreach (Match match in matches)
            {
                string key = match.Groups[1].Value;
                // string
                if (match.Groups[3].Value.Length > 0)
                    result[key] = match.Groups[3].Value;
                else if (match.Groups[4].Value.Length > 0)
                    result[key] = match.Groups[4].Value.ToLower() == "true";
                else if (match.Groups[5].Value.Length > 0)
                    result[key] = float.Parse(match.Groups[5].Value);
                else if (match.Groups[7].Value.Length > 0)
                    result[key] = int.Parse(match.Groups[7].Value);
            }
            return result;
        }


        public IEnumerable<Settings> Parse(string template)
        {
            var boundary = @"^\s*#?\s*(" + string.Join("|", _roles) + @")(\[((\w+)*\s*=\s*\""?([^\""]*)\""?\s*(,?)\s*)+\])?\s*:\s*$";
            var contentBuffer = new List<string>();
            // first role is system (if not specified)
            var argBuffer = new Dictionary<string, object>()
            {
                ["role"] = "system"
            };

            var lines = template.Split('\n');
            foreach (var line in lines)
            {
                if (Regex.IsMatch(line, boundary))
                {
                    if (contentBuffer.Count > 0)
                    {
                        argBuffer["content"] = string.Join("\n", contentBuffer);
                        yield return new Settings(argBuffer);
                        contentBuffer = new List<string>();
                        argBuffer = new Dictionary<string, object>();
                    }

                    if (line.Contains('[') && line.Contains(']'))
                    {
                        var role = Regex.Match(line, boundary);
                        argBuffer["role"] = role.Groups[1].Value;
                        var args = role.Groups[2].Value.Trim().Trim('[', ']');

                        if (args.Length > 0)
                            foreach (var item in ParseArgs(args))
                                argBuffer[item.Key] = item.Value;
                    }
                    else
                        argBuffer["role"] = line.Replace(":", "").Trim().ToLower();

                }
                else
                    contentBuffer.Add(line);
            }

            if (contentBuffer.Count > 0)
            {
                argBuffer["content"] = string.Join("\n", contentBuffer);
                yield return new Settings(argBuffer);
            }
        }

        private IEnumerable<RawMessage> ParseOld(string template)
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
                    yield return new RawMessage { Role = ToChatRole(chunks[i]), Contents = Process(matches, chunks[i + 1]) };
                else
                    yield return new RawMessage { Role = ToChatRole(chunks[i]), Content = chunks[i + 1] };
            }
        }

        private IEnumerable<RawContent> Process(MatchCollection matches, string content)
        {
            var content_chunks = Regex.Split(content, _imageRegex, RegexOptions.Multiline)
                            .Where(s => s.Trim().Length > 0)
                            .Select(s => s.Trim())
                            .ToList();

            int current_chunk = 0;
            for (int i = 0; i < content_chunks.Count; i++)
            {
                var chunk = content_chunks[i];

                // alt entry
                if (current_chunk < matches.Count && chunk == matches[current_chunk].Groups["alt"].Value)
                    continue;
                // image entry
                else if (current_chunk < matches.Count && chunk == matches[current_chunk].Groups["filename"].Value)
                {
                    var img = matches[current_chunk].Groups[2].Value.Split(' ')[0].Trim();
                    var media = img.Split('.').Last().Trim().ToLower();
                    if (media != "jpg" && media != "jpeg" && media != "png")
                        throw new Exception("Invalid image media type (jpg, jpeg, or png are allowed)");

                    if (img.StartsWith("http://") || img.StartsWith("https://"))
                        yield return new RawContent { ContentType = ContentType.RemoteImage, Content = img, Media = $"image/{media}" };
                    else
                        yield return new RawContent { ContentType = ContentType.LocalImage, Content = img, Media = $"image/{media}" };

                    current_chunk++;
                }
                // text entry
                else if (chunk.Trim().Length > 0)
                    yield return new RawContent { ContentType = ContentType.Text, Content = chunk.Trim() };

            }
        }

        private byte[]? GetImageContent(string image, string media)
        {
            var basePath = Path.GetDirectoryName(_prompty.Path);
            var path = basePath != null ? FileUtils.GetFullPath(image, basePath) : Path.GetFullPath(image);
            var bytes = File.ReadAllBytes(path);
            return bytes;
        }

        private async Task<byte[]?> GetImageContentAsync(string image, string media)
        {
            var basePath = Path.GetDirectoryName(_prompty.Path);
            var path = basePath != null ? FileUtils.GetFullPath(image, basePath) : Path.GetFullPath(image);
            var bytes = await FileUtils.ReadAllBytesAsync(path);
            return bytes;
        }
    }
}
