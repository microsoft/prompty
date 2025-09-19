using System.Collections.Concurrent;

namespace Prompty.Core
{
    public class InvokerFactory
    {
        public static InvokerFactory Instance { get; } = new InvokerFactory();

        // make it thread safe for predictable updates
        private readonly ConcurrentDictionary<string, Type> _renderers = [];
        private readonly ConcurrentDictionary<string, Type> _parsers = [];
        private readonly ConcurrentDictionary<string, Type> _executors = [];
        private readonly ConcurrentDictionary<string, Type> _processors = [];

        private InvokerFactory() { }


        public void RegisterInvoker(string name, InvokerType invokerType, Type type)
        {
            switch (invokerType)
            {
                case InvokerType.Renderer:
                    _renderers.AddOrUpdate(name, type, (key, oldValue) => type);
                    break;
                case InvokerType.Parser:
                    _parsers.AddOrUpdate(name, type, (key, oldValue) => type);
                    break;
                case InvokerType.Executor:
                    _executors.AddOrUpdate(name, type, (key, oldValue) => type);
                    break;
                case InvokerType.Processor:
                    _processors.AddOrUpdate(name, type, (key, oldValue) => type);
                    break;
            }
        }

        public bool IsRegistered(string name, InvokerType invokerType)
        {
            return invokerType switch
            {
                InvokerType.Renderer => _renderers.ContainsKey(name),
                InvokerType.Parser => _parsers.ContainsKey(name),
                InvokerType.Executor => _executors.ContainsKey(name),
                InvokerType.Processor => _processors.ContainsKey(name),
                _ => false,
            };
        }

        public Type GetInvoker(string name, InvokerType invokerType)
        {
            if (!IsRegistered(name, invokerType))
                throw new Exception($"{invokerType}.{name} not found!");

            return invokerType switch
            {
                InvokerType.Renderer => _renderers[name],
                InvokerType.Parser => _parsers[name],
                InvokerType.Executor => _executors[name],
                InvokerType.Processor => _processors[name],
                _ => throw new Exception($"{invokerType}.{name} not found!"),
            };
        }

        public void RegisterRenderer(string name, Type type)
        {
            RegisterInvoker(name, InvokerType.Renderer, type);
        }

        public void RegisterParser(string name, Type type)
        {
            RegisterInvoker(name, InvokerType.Parser, type);
        }

        public void RegisterExecutor(string name, Type type)
        {
            RegisterInvoker(name, InvokerType.Executor, type);
        }

        public void RegisterProcessor(string name, Type type)
        {
            RegisterInvoker(name, InvokerType.Processor, type);
        }

        public Invoker CreateInvoker(string name, InvokerType invokerType, Prompty prompty)
        {
            Type type = GetInvoker(name, invokerType);
            return (Invoker)Activator.CreateInstance(type, [prompty])!;
        }

        public Invoker CreateRenderer(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Renderer, prompty);
        }

        public Invoker CreateRenderer(Prompty prompty)
        {
            if (prompty?.Template?.Format == null)
                throw new Exception("Template type not found!");

            return CreateInvoker("", InvokerType.Renderer, prompty!);
        }

        public Invoker CreateParser(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Parser, prompty);
        }

        public Invoker CreateParser(Prompty prompty)
        {
            //if (prompty?.Template?.Parser == null || prompty?.Model?.Api == null)
            //    throw new Exception("Invalid Parser - Parser and Model Api are required");

            var parserType = ""; // $"{prompty?.Template?.Parser}.{prompty?.Model?.Api}";
            return CreateInvoker(parserType, InvokerType.Parser, prompty!);
        }

        public Invoker CreateExecutor(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Executor, prompty);
        }

        public Invoker CreateExecutor(Prompty prompty)
        {

            return CreateInvoker("", InvokerType.Executor, prompty!);
        }

        public Invoker CreateProcessor(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Processor, prompty);
        }

        public static void AutoDiscovery()
        {
            var types = AppDomain.CurrentDomain.GetAssemblies()
                            .SelectMany(a => a.GetTypes())
                            .Where(t => t.IsClass && t.IsSubclassOf(typeof(Invoker)) && t.GetCustomAttributes(typeof(InvokerAttribute), true).Length > 0);

            foreach (var type in types)
            {
                var attributes = (IEnumerable<InvokerAttribute>)type.GetCustomAttributes(typeof(InvokerAttribute), true)!;
                foreach (var attribute in attributes)
                    Instance.RegisterInvoker(attribute.Name, attribute.Type, type);
            }
        }
    }
}
