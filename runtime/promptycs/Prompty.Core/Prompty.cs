using Prompty.Core.Parsers;
using Prompty.Core.Renderers;
using Prompty.Core.Processors;
using Prompty.Core.Executors;
using YamlDotNet.Serialization;
using Prompty.Core.Types;
using System.Dynamic;
using Newtonsoft.Json.Linq;

namespace Prompty.Core
{

    public class Prompty() : BaseModel
    {
        // PromptyModelConfig model, string prompt, bool isFromSettings = true
        // TODO: validate  the prompty attributes needed, what did I miss that should be included?
        [YamlMember(Alias = "name")]
        public string Name;

        [YamlMember(Alias = "description")]
        public string Description;

        [YamlMember(Alias = "version")]
        public string Version;

        [YamlMember(Alias = "tags")]
        public List<string> Tags;

        [YamlMember(Alias = "authors")]
        public List<string> Authors;

        [YamlMember(Alias = "inputs")]
        public Dictionary<string, dynamic> Inputs;

        [YamlMember(Alias = "outputs")]
        public Dictionary<string, dynamic> Outputs;

        [YamlMember(Alias = "sample")]
        public dynamic Sample;


        [YamlMember(Alias = "model")]
        public PromptyModel Model = new PromptyModel();

        public TemplateType TemplateFormatType;
        public string FilePath;
        public bool FromContent = false;

        // This is called from Execute to load a prompty file from location to create a Prompty object.
        // If sending a Prompty Object, this will not be used in execute.
        public static Prompty Load(string promptyFileName, Prompty prompty)
        {

            //Then load settings from prompty file and override if not null
            var promptyFileInfo = new FileInfo(promptyFileName);

            // Get the full path of the prompty file
            prompty.FilePath = promptyFileInfo.FullName;
            var fileContent = File.ReadAllText(prompty.FilePath);
            // parse file in to frontmatter and prompty based on --- delimiter
            var promptyFrontMatterYaml = fileContent.Split("---")[1];
            var promptyContent = fileContent.Split("---")[2];
            // deserialize yaml into prompty object
            prompty = Helpers.ParsePromptyYamlFile(prompty, promptyFrontMatterYaml);
            prompty.Prompt = promptyContent;

            return prompty;
        }

        // Method to Execute Prompty, can send Prompty object or a string
        // This is the main method that will be called to execute the prompty file
        public async Task<Prompty> Execute(string promptyFileName = null,
                                            Prompty? prompty = null,
                                            bool raw = false)
        {

            // check if promptyFileName is null or if prompty is null
            if (promptyFileName == null && prompty == null)
            {
                throw new ArgumentNullException("PromptyFileName or Prompty object must be provided");
            }
            if (prompty == null)
            {
                prompty = new Prompty();
            }

            prompty = Load(promptyFileName, prompty);

            // create invokerFactory
            var invokerFactory = new InvokerFactory();

            // Render
            //this gives me the right invoker for the renderer specificed in the prompty
            //invoker should be a singleton
            //name of invoker should be unique to the process
            //var typeinvoker = invokerFactory.GetRenderer(prompty.TemplateFormatType);

            var render = new RenderPromptLiquidTemplate(prompty, invokerFactory);
            await render.Invoke(prompty);

            // Parse
            var parser = new PromptyChatParser(prompty, invokerFactory);
            await parser.Invoke(prompty);

            // Execute
            var executor = new AzureOpenAIExecutor(prompty, invokerFactory);
            await executor.Invoke(prompty);


            if (!raw)
            {
                // Process
                var processor = new OpenAIProcessor(prompty, invokerFactory);
                await processor.Invoke(prompty);
            }


            return prompty;
        }

    }
}