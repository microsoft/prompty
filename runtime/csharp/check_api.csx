var assembly = System.Reflection.Assembly.LoadFrom(@"C:\Users\sejuare\.nuget\packages\openai\2.10.0\lib\net8.0\OpenAI.dll");
var clientType = assembly.GetType("OpenAI.OpenAIClient");
foreach(var m in clientType.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance))
{
    if(m.Name.ToLower().Contains("model"))
        Console.WriteLine($"{m.Name}({string.Join(", ", m.GetParameters().Select(p => p.ParameterType.Name))})");
}
