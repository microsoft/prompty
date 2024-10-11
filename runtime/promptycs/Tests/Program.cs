namespace Tests;
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using Prompty.Core;

public class Program
{
    public static void Main(string[] args)
    {
        //var inputs = new Dictionary<string, dynamic>
        //    {
        //        { "firstName", "cassie" },
        //        { "lastName", "test" },
        //        { "question", "what is the meaning of life" }
        //    };

        // load chat.json file as new dictionary<string, string>
        var jsonInputs = File.ReadAllText("chat.json");
        // convert json to dictionary<string, string>
        var inputs = JsonConvert.DeserializeObject<Dictionary<string, dynamic>>(jsonInputs);
        string result = RunPrompt(inputs).Result;
        Console.WriteLine(result);
    }

    public static async Task<string> RunPrompt(Dictionary<string, dynamic> inputs)
    {
        //pass a null prompty if you want to load defaults from prompty file
        var prompty = new Prompty();
        prompty.Inputs = inputs;
        prompty = await prompty.Execute("chat.prompty", prompty);
        return prompty.ChatResponseMessage.Content;
    }
}

