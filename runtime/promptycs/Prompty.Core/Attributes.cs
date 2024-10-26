
namespace Prompty.Core
{
    public enum InvokerType
    {
        Renderer,
        Parser,
        Executor,
        Processor
    }

    [AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = false)]
    public class InvokerAttribute(string name, InvokerType type) : Attribute
    {
        public string Name { get; private set; } = name;
        public InvokerType Type { get; private set; } = type;
    }

    [AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = false)]
    public class RendererAttribute(string name) : InvokerAttribute(name, InvokerType.Renderer) { }

    [AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = false)]
    public class ParserAttribute(string name) : InvokerAttribute(name, InvokerType.Parser) { }

    [AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = false)]
    public class ExecutorAttribute(string name) : InvokerAttribute(name, InvokerType.Executor) { }

    [AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = false)]
    public class ProcessorAttribute(string name) : InvokerAttribute(name, InvokerType.Processor) { }

}