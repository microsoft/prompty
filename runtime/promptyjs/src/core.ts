import * as path from "path";
import matter from "gray-matter";
import {
  utils
} from "./utils";
import {
  InvokerFactory
} from "./invokerFactory";
import "./parsers";
import "./renderers";
import * as yaml from 'js-yaml';

export class PropertySettings {
  type: string = "";
  default: any = null;
  description: string = "";
}

// Interface for openaiModel
interface OpenAIModel {
  type: "openai";
  name: string;
  organization?: string;
  api_key: string;
  base_url?: string;
}

// Interface for azureOpenaiModel
interface AzureOpenAIModel {
  type: "azure_openai";
  api_version: string;
  azure_deployment: string;
  azure_endpoint: string;
  api_key?: string
}

// Interface for maasModel
interface MaasModel {
  type: "serverless";
  endpoint: string;
  name: string;
  api_key?: string;
}

export type ModelConfiguration = OpenAIModel | AzureOpenAIModel | MaasModel

export class ModelSettings {
  api: string = "chat";
  configuration: ModelConfiguration = {} as ModelConfiguration;
  parameters: any = {};
  response: any = {};
}

export class TemplateSettings {
  type: string = "jinja2";
  parser: string = "prompty";
}

export interface ExecutionOptions {
  configuration?: any,
  parameters?: any,
  raw?: boolean,
  connection?: any
}

export class Prompty {
  // metadata
  name: string = "";
  description: string = "";
  authors: string[] = [];
  tags: string[] = [];
  version: string = "";
  base: string = "";
  basePrompty: Prompty = null;

  // model
  model: ModelSettings = new ModelSettings();

  // sample
  sample: any = {};

  // input / output
  input: {
    [key: string]: PropertySettings
  } = {};
  output: {
    [key: string]: PropertySettings
  } = {};

  // template
  template: TemplateSettings = new TemplateSettings();

  // misc
  file: string = "";
  content: string = "";

  constructor(content: string) {

    // load file 
    const items = matter(content);
    // metadata
    this.name = items.data.name || "";
    this.description = items.data.description || "";
    this.authors = items.data.authors || [];
    this.tags = items.data.tags || [];
    this.version = items.data.version || "";
    this.base = items.data.base || "";

    // model
    this.model.api = items.data.model?.api || "chat";
    this.model.configuration = items.data.model?.configuration || {};
    this.model.parameters = items.data.model?.parameters || {};
    this.model.response = items.data.model?.response || {};

    // sample
    this.sample = items.data.sample || {};

    // input / output
    this.input = items.data.input || {};
    this.output = items.data.output || {};

    // template
    if (items.data.template && typeof items.data.template === "string") {
      this.template.type = items.data.template || this.template.type;
    } else {
      this.template.type = items.data.template?.type || this.template.type;
      this.template.parser = items.data.template?.parser || this.template.parser;
    }

    // misc
    this.file = content;
    this.content = items.content;
  }

  static async prepare(prompt: Prompty, inputs: any = {}): Promise<any> {
    const invoker = InvokerFactory.getInstance();

    inputs = utils.paramHoisting(inputs, prompt.sample);

    let render: any;

    if (prompt.template.type === "NOOP") {
      render = prompt.content;
    } else {
      render = await invoker.call("renderer", prompt.template.type, prompt, inputs);
    }

    let result: any;

    if (prompt.template.parser === "NOOP") {
      result = render;
    } else {
      result = await invoker.call("parser", `${prompt.template.parser}.${prompt.model.api}`, prompt, render);
    }
    return result;
  }

  static async load(filePath: string): Promise < any > {
    return new Prompty(await utils.readFileSafe(filePath));
  }

  static export(prompt: Prompty): string {
    // Object for the frontmatter attributes
    const front_matter = {
      name : prompt.name,
      description : prompt.description,
      authors : prompt.authors,
      tags : prompt.tags,
      version : prompt.version,
      base : prompt.base,
      model : prompt.model,
      sample : prompt.sample,
      input : prompt.input,
      output : prompt.output,
      template : prompt.template
    };

    const yaml_str = "---\r\n"+ yaml.dump(front_matter) + "---\r\n" + prompt.content;
    return yaml_str;
  }
}