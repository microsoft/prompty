namespace Prompty.Core
{
    public abstract class Invoker
    {
        private Prompty _prompty { get; set; }
        public Invoker(Prompty prompty) => _prompty = prompty;

        public abstract object Invoke(object args);

        public abstract Task<object> InvokeAsync(object args);

        public T Invoke<T>(object args)
        {
            return (T)Invoke(args);
        }

        public async Task<T> InvokeAsync<T>(object args)
        {
            object result = await InvokeAsync(args);
            return (T)result;
        }
    }

    /// <summary>
    /// Pass-through invoker that does nothing.
    /// </summary>
    [Renderer("NOOP")]
    [Parser("NOOP")]
    [Executor("NOOP")]
    [Processor("NOOP")]
    [Parser("prompty.embedding")]
    [Parser("prompty.image")]
    [Parser("prompty.completion")]
    public class NoOpInvoker : Invoker
    {
        public NoOpInvoker(Prompty prompty) : base(prompty) { }

        public override object Invoke(object args) => args;

        public override Task<object> InvokeAsync(object args) => Task.FromResult<object>(args);
    }
}
