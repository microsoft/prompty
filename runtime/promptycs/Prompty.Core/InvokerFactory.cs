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

        private void AddOrUpdateKey(Dictionary<string, Type> dict, string key, Type value)
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
                    AddOrUpdateKey(_renderers, name, type);
                    break;
                case InvokerType.Parser:
                    AddOrUpdateKey(_parsers, name, type);
                    break;
                case InvokerType.Executor:
                    AddOrUpdateKey(_executors, name, type);
                    break;
                case InvokerType.Processor:
                    AddOrUpdateKey(_processors, name, type);
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
            _renderers.Add(name, type);
        }

        public void RegisterParser(string name, Type type)
        {
            _parsers.Add(name, type);
        }

        public void RegisterExecutor(string name, Type type)
        {
            _executors.Add(name, type);
        }

        public void RegisterProcessor(string name, Type type)
        {
            _processors.Add(name, type);
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

        public Invoker CreateParser(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Parser, prompty);
        }

        public Invoker CreateExecutor(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Executor, prompty);
        }

        public Invoker CreateProcessor(string name, Prompty prompty)
        {
            return CreateInvoker(name, InvokerType.Processor, prompty);
        }

        public void AutoRegister()
        {
            var types = AppDomain.CurrentDomain.GetAssemblies()
                            .SelectMany(a => a.GetTypes())
                            .Where(t => t.IsClass && t.IsSubclassOf(typeof(Invoker)) && t.GetCustomAttributes(typeof(InvokerAttribute), true).Length > 0);

            foreach (var type in types)
            {
                var attributes = (IEnumerable<InvokerAttribute>)type.GetCustomAttributes(typeof(InvokerAttribute), true)!;
                foreach (var attribute in attributes)
                    RegisterInvoker(attribute.Name, attribute.Type, type);
            }
        }
    }
}
