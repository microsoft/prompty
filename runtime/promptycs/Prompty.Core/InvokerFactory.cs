using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

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
            switch(invokerType)
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
            switch (invokerType)
            {
                case InvokerType.Renderer:
                    return _renderers.ContainsKey(name);
                case InvokerType.Parser:
                    return _parsers.ContainsKey(name);
                case InvokerType.Executor:
                    return _executors.ContainsKey(name);
                case InvokerType.Processor:
                    return _processors.ContainsKey(name);
                default:
                    return false;
            }
        }

        public Type GetInvoker(string name, InvokerType invokerType)
        {
            if (!IsRegistered(name, invokerType))
                throw new Exception($"{invokerType.ToString()}.{name} not found!");

            switch (invokerType) {
                case InvokerType.Renderer:
                    return _renderers[name];
                case InvokerType.Parser:
                    return _parsers[name];
                case InvokerType.Executor:
                    return _executors[name];
                case InvokerType.Processor:
                    return _processors[name];
                default:
                    throw new Exception($"{invokerType.ToString()}.{name} not found!");
            }
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
            if(prompty?.Template?.Format == null)
                throw new Exception("Template type not found!");

            return CreateInvoker(prompty?.Template?.Format!, InvokerType.Renderer, prompty!);
        }

        public Invoker CreateParser(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Parser, prompty);
        }

        public Invoker CreateParser(Prompty prompty)
        {
            if (prompty?.Template?.Parser == null || prompty?.Model?.Api == null)
                throw new Exception("Invalid Parser - Parser and Model Api are required");

            var parserType = $"{prompty?.Template?.Parser}.{prompty?.Model?.Api}";
            return CreateInvoker(parserType, InvokerType.Parser, prompty!);
        }

        public Invoker CreateExecutor(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Executor, prompty);
        }

        public Invoker CreateExecutor(Prompty prompty)
        {
            if(prompty?.Model?.Configuration?.Type == null)
                throw new Exception("Model Configuration type not found!");

            return CreateInvoker(prompty?.Model?.Configuration?.Type!, InvokerType.Executor, prompty!);
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
