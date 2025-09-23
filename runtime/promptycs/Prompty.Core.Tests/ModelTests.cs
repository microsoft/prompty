using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization.Metadata;

namespace Prompty.Core.Tests;

public class ModelTests
{
    public ModelTests()
    {

    }

    [Fact]
    public void TestLoadInput()
    {
        var json_data = """
        {
          "name": "my-input",
          "kind": "string",
          "description": "A description of the input property",
          "required": true,
          "strict": true,
          "default": "default value",
          "sample": "sample value"
        }
        """;

        // deserialize unknown json into dictionary
        var dict = JsonSerializer.Deserialize<Input>(json_data);

        //var dict2 = JsonSerializer.Deserialize(dict,);
        //var instance = Input.Load(dict!);
        Assert.True(true);
    }
}
