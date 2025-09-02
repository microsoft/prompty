using Microsoft.Extensions.AI;
using System.Text.RegularExpressions;

namespace Prompty.Core.Parsers
{
    public enum ContentType
    {
        Text,
        RemoteImage,
        DataImage,
    }

    public struct RawMessage
    {
        public ChatRole Role { get; set; }
        public List<RawContent> Contents { get; set; }
        public Dictionary<string, object> Args { get; set; }

        public RawMessage(ChatRole role)
        {
            Role = role;
            Contents = new List<RawContent>();
            Args = new Dictionary<string, object>();
        }
    }

    public struct RawContent
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
                var contents = m.Contents.Select<RawContent, AIContent>(c =>
                {
                    switch (c.ContentType)
                    {
                        case ContentType.Text:
                            return new TextContent(c.Content);
                        case ContentType.RemoteImage:
                            return new UriContent(uri: c.Content, mediaType: c.Media);
                        case ContentType.DataImage:
                            var imageData = Convert.FromBase64String(c.Content);
                            return new DataContent(data: imageData, mediaType: c.Media);
                        default:
                            throw new Exception("Invalid content type!");
                    }
                }).ToList();

                return new ChatMessage(m.Role, contents);
            }).ToArray();

            return messages;

        }

        public async override Task<object> InvokeAsync(object args)
        {
            return await Task.Run(() => Invoke(args));
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


        public IEnumerable<RawMessage> Parse(string template)
        {
            var boundary = @"^\s*#?\s*(" + string.Join("|", _roles) + @")(\[((\w+)*\s*=\s*\""?([^\""]*)\""?\s*(,?)\s*)+\])?\s*:\s*$";
            
            RawMessage rawMessage = new RawMessage(ChatRole.System); // default role

            var lines = template.Split('\n');
            foreach (var line in lines)
            {
                if (Regex.IsMatch(line, boundary))
                {
                    bool hasArgs = line.Contains('[') && line.Contains(']');
                    var roleGroups = hasArgs ? Regex.Match(line, boundary) : null;
                    string roleString = hasArgs && roleGroups != null ? roleGroups.Groups[1].Value : line.Replace(":", "").Trim().ToLower();

                    ChatRole role = ToChatRole(roleString);
                    if (rawMessage.Role != role)
                    {
                        // If the role has changed, yield the current message
                        // and start a new one
                        if (rawMessage.Contents.Count > 0)
                        {
                            yield return rawMessage;
                        }
                        rawMessage = new RawMessage(role);
                    }

                    if (hasArgs && roleGroups != null)
                    {
                        var args = roleGroups.Groups[2].Value.Trim().Trim('[', ']');
                        if (args.Length > 0)
                            foreach (var item in ParseArgs(args))
                            {
                                rawMessage.Args[item.Key] = item.Value;
                            }
                    }
                }
                else
                {
                    AddRawMessageContent(rawMessage, line.Trim());
                }
            }

            yield return rawMessage;
        }

        private void AddRawMessageContent(RawMessage rawMessage, string content)
        {
            if (string.IsNullOrEmpty(content))
                return;

            var rawContent = ProcessImageContent(content);
            if (rawContent != null)
            {
                rawMessage.Contents.Add((RawContent)rawContent);
            }
            else
            {
                rawMessage.Contents.Add(new RawContent
                {
                    ContentType = ContentType.Text,
                    Content = content,
                });
            }
        }

        /// <summary>
        /// This method processes the image in markdown format: ![alt text dfdv](camping.jpg \"Title cds csd dsc\")
        /// </summary>
        private RawContent? ProcessImageContent(string content)
        {
            var content_chunks = Regex.Split(content, _imageRegex, RegexOptions.Multiline)
                            .Where(s => s.Trim().Length > 0)
                            .Select(s => s.Trim())
                            .ToList();

            if (content_chunks.Count != 2 || !content_chunks[0].StartsWith("![alt"))
            {
                return null;
            }

            if (content_chunks[1].StartsWith("data:image"))
            {
                SplitDataUri(content_chunks[1], out var mediaType, out var data);
                // Case 1: data URI
                return new RawContent { ContentType = ContentType.DataImage, Content = data, Media = mediaType };
            }
            else
            {
                SplitImageUri(content_chunks[1], out var imagePath, out var mediaType, out var isRemote);

                if (isRemote)
                {
                    // Case 2: remote image
                    return new RawContent { ContentType = ContentType.RemoteImage, Content = imagePath, Media = mediaType };
                }
                else
                {
                    try
                    {
                        var imageContent = GetImageContent(imagePath, mediaType);
                        if (imageContent != null)
                        {
                            // Case 3: local image
                            return new RawContent { ContentType = ContentType.DataImage, Content = Convert.ToBase64String(imageContent), Media = mediaType };
                        }
                    }
                    catch (Exception)
                    {
                    }
                }
            }

            return null;
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

        private void SplitDataUri(string dataUri, out string mediaType, out string data)
        {
            if (string.IsNullOrWhiteSpace(dataUri) || !dataUri.StartsWith("data:"))
            {
                throw new ArgumentException("Invalid Data URI");
            }

            // Split the data URI into data and title
            dataUri = dataUri.Split(' ')[0].Trim();

            // Find the first comma  
            int commaIndex = dataUri.IndexOf(',');
            if (commaIndex == -1)
            {
                throw new ArgumentException("Invalid Data URI: no data found");
            }

            // Split the metadata and data  
            string metadata = dataUri.Substring(0, commaIndex);
            data = dataUri.Substring(commaIndex + 1); // Extract data after the comma  

            // Now split the metadata  
            string[] metadataParts = metadata.Split(new[] { ';' }, 2);
            mediaType = metadataParts[0].Substring(5); // Remove 'data:'  
        }

        private void SplitImageUri(string imageUri, out string imagePath, out string mediaType, out bool isRemote)
        {
            if (string.IsNullOrWhiteSpace(imageUri))
            {
                throw new ArgumentException("Invalid Image URI");
            }

            // Find the first space  
            imagePath = imageUri.Split(' ')[0].Trim();
            if (string.IsNullOrWhiteSpace(imagePath))
            {
                throw new ArgumentException("Invalid Image URI: no image path found");
            }

            // Find the file extension and convert to media type
            var media = imagePath.Split('.').Last().Trim().ToLower();
            if (media != "jpg" && media != "jpeg" && media != "png")
                throw new Exception("Invalid image media type (jpg, jpeg, or png are allowed)");
            mediaType = $"image/{media}";

            // Check if the image path is local or remote 
            isRemote = imagePath.StartsWith("http://") || imagePath.StartsWith("https://");
        }
    }
}
