using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using YamlDotNet.Serialization;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace Prompty.Core
{
    public class Tool
    {
        [YamlMember(Alias = "id")]
        public string? id { get; set; }
        [YamlMember(Alias = "type")]
        public string? Type { get; set; }
        [YamlMember(Alias = "function")]
        public Function? Function { get; set; }
    }

    public class Function
    {
        [YamlMember(Alias = "arguments")]
        public string? Arguments { get; set; }
        [YamlMember(Alias = "name")]
        public string? Name { get; set; }
        [YamlMember(Alias = "parameters")]
        public Parameters? Parameters { get; set; }
        [YamlMember(Alias = "description")]
        public string? Description { get; set; }


    }
    public class Parameters
    {
        [YamlMember(Alias = "description")]
        public string? Description { get; set; }
        [YamlMember(Alias = "type")]
        public string? Type { get; set; }
        [YamlMember(Alias = "properties")]
        public object? Properties { get; set; }
        [YamlMember(Alias = "prompt")]
        public string? Prompt { get; set; }
    }

}
