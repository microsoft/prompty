
namespace Prompty.Core
{
  public class PropertySettings
  {
    public required string Type { get; set; }
    public object? Default { get; set; }
    public string Description { get; set; } = "";
  }

  public class ModelSettings
  {
    public string Api { get; set; } = "";

    // TODO: this should be an interface
    public object Configuration { get; set; } = "";


    // TODO: this should be an interface
    public object Parameters { get; set; } = "";

    // TODO: this should be an interface
    public object Response { get; set; } = "";

  }

  public class TemplateSettings
  {
    public string Type { get; set; } = "";
    public string Parser { get; set; } = "";
  }

  public class Prompty
  {
    // Metadata
    public string Name { get; set; } ="";
    public string Description { get; set; } = "";
    public string[] Authors { get; set; } = [];
    public string Version { get; set; } = "";
    public string Base { get; set; } = "";
    public Prompty? BasePrompty { get; set; } = null;

    // Model
    public ModelSettings Model { get; set; } = new ModelSettings();

    // Sample
    public string Sample { get; set; } = "";

    // input / output
    public Dictionary<string, PropertySettings> Inputs { get; set; } = new Dictionary<string, PropertySettings>();
    public Dictionary<string, PropertySettings> Outputs { get; set; } = new Dictionary<string, PropertySettings>();

    // template
    public TemplateSettings Template { get; set; } = new TemplateSettings();

    public string File { get; set; } = "";

    public object Content { get; set; } = "";
  }
}