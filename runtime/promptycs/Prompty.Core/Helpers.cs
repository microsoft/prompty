using global::Prompty.Core.Types;
using Microsoft.Extensions.Configuration;
using YamlDotNet.Serialization;

namespace Prompty.Core
{

    public static class Helpers
    {
        // This is to load the appsettings.json file config 
        // These are the base configuration settings for the prompty file
        // These can be overriden by the prompty file, or the execute method
        public static PromptyModelConfig GetPromptyModelConfigFromSettings()
        {
            //TODO: default prompty json, can have multiple sections, need to loop thru sections?
            //TODO: account for multiple prompty.json files
            // Get the connection string from appsettings.json
            var config = new ConfigurationBuilder()
                            .SetBasePath(AppDomain.CurrentDomain.BaseDirectory)
                            .AddJsonFile("appsettings.json").Build();

            var section = config.GetSection("Prompty");
            // get variables from section and assign to promptymodelconfig
            var promptyModelConfig = new PromptyModelConfig();
            if (section != null)
            {
                var type = section["type"];
                var apiVersion = section["api_version"];
                var azureEndpoint = section["azure_endpoint"];
                var azureDeployment = section["azure_deployment"];
                var apiKey = section["api_key"];


                if (type != null)
                {
                    //parse type to ModelType enum
                    promptyModelConfig.ModelType = (ModelType)Enum.Parse(typeof(ModelType), type);

                }
                if (apiVersion != null)
                {
                    promptyModelConfig.ApiVersion = apiVersion;
                }
                if (azureEndpoint != null)
                {
                    promptyModelConfig.AzureEndpoint = azureEndpoint;
                }
                if (azureDeployment != null)
                {
                    promptyModelConfig.AzureDeployment = azureDeployment;
                }
                if (apiKey != null)
                {
                    promptyModelConfig.ApiKey = apiKey;
                }
            }

            return promptyModelConfig;
        }


        public static Prompty ParsePromptyYamlFile(Prompty prompty, string promptyFrontMatterYaml)
        {
            // desearialize yaml front matter
            // TODO: check yaml to see what props are missing? update to include template type, update so invoker descides based on prop
            var deserializer = new DeserializerBuilder().Build();
            var promptyFrontMatter = deserializer.Deserialize<Prompty>(promptyFrontMatterYaml);

            // override props if they are not null from file
            if (promptyFrontMatter.Name != null)
            {
                // check each prop and if not null override
                if (promptyFrontMatter.Name != null)
                {
                    prompty.Name = promptyFrontMatter.Name;
                }
                if (promptyFrontMatter.Description != null)
                {
                    prompty.Description = promptyFrontMatter.Description;
                }
                if (promptyFrontMatter.Tags != null)
                {
                    prompty.Tags = promptyFrontMatter.Tags;
                }
                if (promptyFrontMatter.Authors != null)
                {
                    prompty.Authors = promptyFrontMatter.Authors;
                }
                if (promptyFrontMatter.Inputs != null)
                {                  
                    prompty.Inputs = promptyFrontMatter.Inputs;
                }
                if(promptyFrontMatter.Outputs != null)
                {
                    prompty.Outputs = promptyFrontMatter.Outputs;
                }
                if(promptyFrontMatter.Sample != null)
                {
                    //if sample value is a string value, it should be read as a file and parsed to a dict.
                    if(promptyFrontMatter.Sample is string)
                    {
                        //parse the file
                        var sampleFile = File.ReadAllText(promptyFrontMatter.Sample);
                        prompty.Sample = deserializer.Deserialize<Dictionary<string, object>>(sampleFile);
                    }
                    else
                    {
                        prompty.Sample = promptyFrontMatter.Sample;
                    }
                }
                // parse out model params
                if (promptyFrontMatter.Model != null)
                {
                    //set model settings
                    prompty.Model = promptyFrontMatter.Model;
                    //override from appsettings
                    // prompty.Model.ModelConfiguration = Helpers.GetPromptyModelConfigFromSettings();

                }
            }

            return prompty;

        }
    }
}