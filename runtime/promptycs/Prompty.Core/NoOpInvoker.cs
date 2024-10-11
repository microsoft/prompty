namespace Prompty.Core
{
    public class NoOpInvoker : IInvoker
    {
        public async Task<BaseModel> Invoke(BaseModel data)
        {
            return data;
        }
    }
}
