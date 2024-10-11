
using Prompty.Core.Types;

namespace Prompty.Core
{

    public class InvokerFactory
    {
        // dict of string name, and invoker
        private Dictionary<string, IInvoker> _renderers;
        private Dictionary<string, IInvoker> _parsers;
        private Dictionary<string, IInvoker> _executors;
        private Dictionary<string, IInvoker> _processors;

        public InvokerFactory()
        {
            _renderers = new Dictionary<string, IInvoker>();
            _parsers = new Dictionary<string, IInvoker>();
            _executors = new Dictionary<string, IInvoker>();
            _processors = new Dictionary<string, IInvoker>();
        }

        public static InvokerFactory Instance { get; private set; }

        public static InvokerFactory GetInstance()
        {
            if (Instance == null)
            {
                Instance = new InvokerFactory();
            }
            return Instance;
        }



        public void Register(InvokerType type, string name, IInvoker invoker)
        {
            switch (type)
            {
                case InvokerType.Renderer:
                    _renderers.Add(name, invoker);
                    break;
                case InvokerType.Parser:
                    _parsers.Add(name, invoker);
                    break;
                case InvokerType.Executor:
                    _executors.Add(name, invoker);
                    break;
                case InvokerType.Processor:
                    _processors.Add(name, invoker);
                    break;
                default:
                    throw new ArgumentException($"Invalid type: {type}");
            }
        }

        public Task<BaseModel> Call(InvokerType type, string name, BaseModel data)
        {
            switch (type)
            {
                case InvokerType.Renderer:
                    return _renderers[name].Invoke(data);
                case InvokerType.Parser:
                    return _parsers[name].Invoke(data);
                case InvokerType.Executor:
                    return _executors[name].Invoke(data);
                case InvokerType.Processor:
                    return _processors[name].Invoke(data);
                default:
                    throw new ArgumentException($"Invalid type: {type}");

            }
        }


    }
}