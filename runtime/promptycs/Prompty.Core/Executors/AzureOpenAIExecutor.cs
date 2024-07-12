using Azure.AI.OpenAI;
using Azure;
using Prompty.Core.Types;

namespace Prompty.Core.Executors
{
    public class AzureOpenAIExecutor : IInvoker
    {
        private readonly OpenAIClient client;
        private readonly string api;
        private readonly string? deployment;
        private readonly dynamic? parameters;
        private readonly ChatCompletionsOptions chatCompletionsOptions;
        private readonly CompletionsOptions completionsOptions;
        private readonly ImageGenerationOptions imageGenerationOptions;
        private readonly EmbeddingsOptions embeddingsOptions;

        public AzureOpenAIExecutor(Prompty prompty, InvokerFactory invoker)
        {
            var invokerName = ModelType.azure_openai.ToString();
            invoker.Register(InvokerType.Executor, invokerName, this);
            client = new OpenAIClient(
                endpoint: new Uri(prompty.Model.ModelConfiguration.AzureEndpoint),
                keyCredential: new AzureKeyCredential(prompty.Model.ModelConfiguration.ApiKey)
            );

            api = prompty.Model.Api.ToString();
            parameters = prompty.Model.Parameters;

            chatCompletionsOptions = new ChatCompletionsOptions()
            {
                DeploymentName = prompty.Model.ModelConfiguration.AzureDeployment
            };
            completionsOptions = new CompletionsOptions()
            {
                DeploymentName = prompty.Model.ModelConfiguration.AzureDeployment
            };
            imageGenerationOptions = new ImageGenerationOptions()
            {
                DeploymentName = prompty.Model.ModelConfiguration.AzureDeployment
            };
            embeddingsOptions = new EmbeddingsOptions()
            {
                DeploymentName = prompty.Model.ModelConfiguration.AzureDeployment
            };

        }

        public async Task<BaseModel> Invoke(BaseModel data)
        {

            if (api == ApiType.Chat.ToString())
            {
                try
                {


                    for (int i = 0; i < data.Messages.Count; i++)
                    {
                        //parse role sting to enum value
                        var roleEnum = Enum.Parse<RoleType>(data.Messages[i]["role"]);

                        switch (roleEnum)
                        {
                            case RoleType.user:
                                var userMessage = new ChatRequestUserMessage(data.Messages[i]["content"]);
                                chatCompletionsOptions.Messages.Add(userMessage);
                                break;
                            case RoleType.system:
                                var systemMessage = new ChatRequestSystemMessage(data.Messages[i]["content"]);
                                chatCompletionsOptions.Messages.Add(systemMessage);
                                break;
                            case RoleType.assistant:
                                var assistantMessage = new ChatRequestAssistantMessage(data.Messages[i]["content"]);
                                chatCompletionsOptions.Messages.Add(assistantMessage);
                                break;
                            case RoleType.function:
                                //TODO: Fix parsing for Function role
                                var functionMessage = new ChatRequestFunctionMessage("name", data.Messages[i]["content"]);
                                chatCompletionsOptions.Messages.Add(functionMessage);
                                break;
                        }

                    }
                    var response = await client.GetChatCompletionsAsync(chatCompletionsOptions);
                    data.ChatResponseMessage = response.Value.Choices[0].Message;

                }
                catch (Exception error)
                {
                    Console.Error.WriteLine(error);
                }
            }
            else if (api == ApiType.Completion.ToString())
            {
                try
                {
                    var response = await client.GetCompletionsAsync(completionsOptions);
                    data.CompletionResponseMessage = response.Value;

                }
                catch (Exception error)
                {
                    Console.Error.WriteLine(error);
                }
            }
            //else if (api == ApiType.Embedding.ToString())
            //{
            //    try
            //    {
            //        var response = await client.GetEmbeddingsAsync(embeddingsOptions);
            //        data.EmbeddingResponseMessage = response.Value;

            //    }
            //    catch (Exception error)
            //    {
            //        Console.Error.WriteLine(error);
            //    }
            //}
            //else if (api == ApiType.Image.ToString())
            //{
            //    try
            //    {
            //        var response = await client.GetImageGenerationsAsync(imageGenerationOptions);
            //        data.ImageResponseMessage = response.Value;

            //    }
            //    catch (Exception error)
            //    {
            //        Console.Error.WriteLine(error);
            //    }
            //}


            return data;
        }

    }

}
