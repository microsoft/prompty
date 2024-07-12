using Prompty.Core.Types;
using YamlDotNet.Serialization;

namespace Prompty.Core
{
    public class PromptyModel
    {
        [YamlMember(Alias = "api")]
        public ApiType Api { get; set; }
        [YamlMember(Alias = "configuration")]
        public PromptyModelConfig? ModelConfiguration;
        [YamlMember(Alias = "parameters")]
        public PromptyModelParameters? Parameters;
        [YamlMember(Alias = "response")]
        public string? Response { get; set; }
    }
}
