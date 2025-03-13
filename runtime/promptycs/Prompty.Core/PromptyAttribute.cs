using Microsoft.Extensions.AI;
using System.Reflection;

namespace Prompty.Core;

/// <summary>
/// Prompty Attribute - used to load a prompty file or resource from an attribute
/// </summary>
/// <usage>
/// [Prompty("prompty/basic.prompty"]
/// [Prompty("prompty/embedded-resource-path.prompty", IsResource = true)]
/// public class MyClass
/// {...} 
/// in a class or method then use the attribute to load the prompty
/// ...
/// var prompty = (PromptyAttribute)Attribute.GetCustomAttribute(typeof(MyClass), typeof(PromptyAttribute));
/// var messages = prompty.Messages;
/// ...
/// </usage>
public class PromptyAttribute : Attribute
{
    /// <summary>
    /// The file name of the prompty file
    public string File { get; set; }

    /// <summary>
    /// Is the file a resource
    /// </summary>
    public bool IsResource { get; set; } = false;
    
    /// <summary>
    /// The configuration id to use
    /// </summary>
    public string? Configuration { get; set; }

    /// <summary>
    /// The parameters for input
    /// </summary>
    public string[]? Params { get; set; }

    /// <summary>
    /// the loaded prompty
    /// </summary>
    public Prompty Prompt { get; set; }

    /// <summary>
    /// The prepared messages
    /// </summary>
    public ChatMessage[] Messages => (ChatMessage[])Prompt.Prepare();

    public PromptyAttribute(string File, bool IsResource = false, string Configuration = "default", string[] Params = null!)
    {
        this.File = File;
        this.IsResource = IsResource;
        this.Configuration = Configuration;
        this.Params = Params;

        if (IsResource == true)
        {
            // get the stream from the resource name
            var assembly = Assembly.GetExecutingAssembly();
            using var stream = assembly.GetManifestResourceStream(File);
            if (stream == null)
            {
                throw new FileNotFoundException($"Resource {File} not found");
            }
            this.Prompt = Prompty.Load(stream, Configuration);
        }
        else
        {
            if (!System.IO.File.Exists(File))
            {
                throw new FileNotFoundException($"File {File} not found");
            }
            // load the file
            this.Prompt = Prompty.Load(File, Configuration);
        }

    }
}
