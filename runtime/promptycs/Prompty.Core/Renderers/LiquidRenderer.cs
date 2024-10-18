using System;


namespace Prompty.Core.Renderers
{
    [Renderer("jinja2")]
    [Renderer("liquid")]
    public class LiquidRenderer : Invoker
    {
        public LiquidRenderer(Prompty prompty) : base(prompty) { }
        public override object Invoke(object args)
        {
            throw new NotImplementedException();
        }

        public override Task<object> InvokeAsync(object args)
        {
            throw new NotImplementedException();
        }
    }
}
