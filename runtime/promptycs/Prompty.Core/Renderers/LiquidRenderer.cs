using System;
using Scriban;

namespace Prompty.Core.Renderers
{
    [Renderer("jinja2")]
    [Renderer("liquid")]
    public class LiquidRenderer : Invoker
    {
        public LiquidRenderer(Prompty prompty) : base(prompty) { }
        public override object Invoke(object args)
        {
            // TODO - figure out base templating using liquid
            var template = Scriban.Template.ParseLiquid("");
            return template.Render(args);
        }

        public override Task<object> InvokeAsync(object args)
        {
            return Task.FromResult(Invoke(args));
        }
    }
}
