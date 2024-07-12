using System.Text.RegularExpressions;
using System.Xml.Linq;
using Prompty.Core.Types;
using Scriban;

namespace Prompty.Core.Renderers;

public class RenderPromptLiquidTemplate : IInvoker
{
    private string _templatesGeneraged;
    private Prompty _prompty;
    private InvokerFactory _invokerFactory;
    // create private invokerfactory and init it

    public RenderPromptLiquidTemplate(Prompty prompty, InvokerFactory invoker)
    {
        _prompty = prompty;
        _invokerFactory = invoker;
    }
    

    public void RenderTemplate()
    {
        var template = Template.ParseLiquid(_prompty.Prompt);
        _prompty.Prompt = template.Render(_prompty.Inputs);
        _templatesGeneraged = _prompty.Prompt;
        
    }

    public async Task<BaseModel> Invoke(BaseModel data)
    {
        this.RenderTemplate();
        _invokerFactory.Register(InvokerType.Renderer, TemplateType.liquid.ToString(), this);
        //TODO: fix this with correct DI logic
        data.Prompt =  _templatesGeneraged;
        return data;
    }

}
