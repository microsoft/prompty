using Microsoft.Extensions.AI;
using System.Reflection;

namespace Prompty.Core;

/// <summary>
/// Prompty Attribute - used to load a prompty file or resource from an attribute
/// </summary>
/// <usage>
/// [Prompty("prompty/basic.prompty"]
/// [Prompty("prompty/embedded-resource-path.prompty", IsResource = true, Configuration = "default", Params = new string[] { "question", "answer" })]
/// public class MyClass
/// {...} 
/// in a class or method then use the attribute to load the prompty
/// ...
/// var prompty = (PromptyAttribute)Attribute.GetCustomAttribute(typeof(MyClass), typeof(PromptyAttribute));
/// var messages = prompty.Messages;
/// ...
/// </usage>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
public class PromptyAttribute(string File, bool IsResource = false, string Configuration = "default", string[] Params = null!) : Attribute
{
    /// <summary>
    /// The file name of the prompty file
    public string File { get; set; } = File;

    /// <summary>
    /// Is the file a resource
    /// </summary>
    public bool IsResource { get; set; } = IsResource;

    /// <summary>
    /// The configuration id to use
    /// </summary>
    public string? Configuration { get; set; } = Configuration;

    /// <summary>
    /// The parameters for input
    /// </summary>
    public string[]? Params { get; set; } = Params;

    /// <summary>
    /// the loaded prompty
    /// </summary>
    public Prompty? Prompt => GetPrompt();

    /// <summary>
    /// The prepared messages
    /// </summary>
    public ChatMessage[] Messages => GetMessages();

    /// <summary>
    /// Attempts to find a resource in multiple assemblies
    /// </summary>
    /// <param name="resourceName">The resource name to find</param>
    /// <returns>A Stream for the resource if found, null otherwise</returns>
    private Stream? FindResourceInAssemblies(string resourceName)
    {
        // Normalize resource name to handle different path formats
        var normalizedName = resourceName.Replace('\\', '.').Replace('/', '.');
        
        // Helper function to check for resource in an assembly
        Stream? TryGetResourceStream(Assembly assembly, string name)
        {
            // Try direct match
            var stream = assembly.GetManifestResourceStream(name);
            if (stream != null)
                return stream;
            
            // Try assembly qualified name
            stream = assembly.GetManifestResourceStream($"{assembly.GetName().Name}.{name}");
            if (stream != null)
                return stream;
            
            // Try suffix match with all manifest resources
            var resourceNames = assembly.GetManifestResourceNames();
            var matchingResource = resourceNames.FirstOrDefault(r => 
                r.EndsWith(normalizedName, StringComparison.OrdinalIgnoreCase) || 
                r.EndsWith(name, StringComparison.OrdinalIgnoreCase));
                
            if (!string.IsNullOrEmpty(matchingResource))
                return assembly.GetManifestResourceStream(matchingResource);
                
            return null;
        }
        
        // Try executing assembly (the assembly containing this code)
        var executingAssembly = Assembly.GetExecutingAssembly();
        var stream = TryGetResourceStream(executingAssembly, resourceName);
        if (stream != null)
            return stream;
        
        // Try entry assembly (the main application assembly)
        var entryAssembly = Assembly.GetEntryAssembly();
        if (entryAssembly != null && entryAssembly != executingAssembly)
        {
            stream = TryGetResourceStream(entryAssembly, resourceName);
            if (stream != null)
                return stream;
        }
        
        // Try all other loaded assemblies
        return AppDomain.CurrentDomain.GetAssemblies()
            .Where(a => a != executingAssembly && a != entryAssembly)
            .Select(a => TryGetResourceStream(a, resourceName))
            .FirstOrDefault(s => s != null);
    }

    /// <summary>
    /// convert the params to a dictionary
    /// </summary>
    /// <returns>Dictionary<string, string></returns>
    private Dictionary<string, object> GetParams()
    {
        var dict = new Dictionary<string, object>();
        if (Params != null)
        {
            for (int i = 0; i < Params.Length; i += 2)
            {
                if (i + 1 < Params.Length)
                    dict.Add(Params[i], Params[i + 1]);
            }
        }
        return dict;
    }

    /// <summary>
    /// Get the prompt from the file or resource
    /// </summary>
    /// <returns>Prompty</returns>
    /// <exception cref="FileNotFoundException"></exception>
    private Prompty GetPrompt()
    {
        Prompty? prompt = null;
        if (IsResource == true)
        {
            // Try to get the resource from various assemblies
            Stream? stream = FindResourceInAssemblies(File);
            
            if (stream == null)
            {
                throw new FileNotFoundException($"Resource {File} not found");
            }
            
            using (stream)
            {
                prompt = Prompty.Load(stream, Configuration ?? "default");
            }
        }
        else
        {
            if (!System.IO.File.Exists(File))
            {
                throw new FileNotFoundException($"File {File} not found");
            }
            // load the file
            prompt = Prompty.Load(File, Configuration ?? "default");
        }
        return prompt;
    }
    
    /// <summary>
    /// Get the messages from the prompt
    /// </summary>
    /// <returns>ChatMessage[]</returns>
    /// <exception cref="InvalidOperationException"></exception>
    private ChatMessage[] GetMessages()
    {
        InvokerFactory.AutoDiscovery();
        if (Prompt == null)
            throw new InvalidOperationException("Prompt is null");
        return (ChatMessage[])Prompt.Prepare(GetParams(), mergeSample: true);
    }
}
