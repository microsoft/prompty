using System;
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

        private readonly Dictionary<string, Type> _renderers = [];
        private readonly Dictionary<string, Type> _parsers = [];
        private readonly Dictionary<string, Type> _executors = [];
        private readonly Dictionary<string, Type> _processors = [];

        private InvokerFactory() { }

        private void AddOrUpdate(Dictionary<string, Type> dict, string key, Type value)
        {
            if (dict.ContainsKey(key))
                dict[key] = value;
            else
                dict.Add(key, value);
        }

        public void RegisterInvoker(string name, InvokerType invokerType, Type type)
        {
            switch(invokerType)
            {
                case InvokerType.Renderer:
                    AddOrUpdate(_renderers, name, type);
                    break;
                case InvokerType.Parser:
                    AddOrUpdate(_parsers, name, type);
                    break;
                case InvokerType.Executor:
                    AddOrUpdate(_executors, name, type);
                    break;
                case InvokerType.Processor:
                    AddOrUpdate(_processors, name, type);
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
            AddOrUpdate(_renderers, name, type);
        }

        public void RegisterParser(string name, Type type)
        {
            AddOrUpdate(_parsers, name, type);
        }

        public void RegisterExecutor(string name, Type type)
        {
            AddOrUpdate(_executors, name, type);
        }

        public void RegisterProcessor(string name, Type type)
        {
            AddOrUpdate(_processors, name, type);
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
            if(prompty?.Template?.Type == null)
                throw new Exception("Template type not found!");

            return CreateInvoker(prompty?.Template?.Type!, InvokerType.Renderer, prompty!);
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
