namespace Prompty.Core
{
    public interface IInvoker
    {
        public abstract Task<BaseModel> Invoke(BaseModel data);

        public async Task<BaseModel> Call(BaseModel data)
        {
            return await Invoke(data);
        }

    }

}
