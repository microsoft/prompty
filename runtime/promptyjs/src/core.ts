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
import path from "path";
import { glob } from "glob";

export class PropertySettings {
  type: string = "";
  default: any = null;
  description: string = "";
}

export class ModelConfiguration {
  type: string = "unknown";
  [key: string]: any;
}

export class ModelSettings {
  api: string = "chat";
  configuration: ModelConfiguration = { type: "unknown" } as ModelConfiguration;
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
  basePrompty?: Prompty;

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

    // load file - CVE Security Fix: Disable JavaScript execution in front matter
    const items = matter(content, {
      engines: {
        yaml: {
          parse: (input: string) => yaml.load(input) as object
        },
        js: {
          parse: (input) => { console.log("JS execution disabled"); return {}; }
        }
      }
    });
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

  private static async _findGlobalConfig(promptyPath: string): Promise<string | undefined> {
    const configs = await glob("**/prompty.json", {
      cwd: process.cwd(),
    });

    const filtered = configs.map(c => path.resolve(c))
      .filter((config) => config.length <= promptyPath.length)
      .sort((a, b) => a.length - b.length);

    if (filtered.length > 0) {
      return filtered[filtered.length - 1];
    } else {
      return undefined;
    }
  }

  static async load(filePath: string, configuration: string = "default"): Promise<any> {
    filePath = path.resolve(filePath);
    const p = new Prompty(await utils.readFileSafe(filePath));
    const c = await Prompty._findGlobalConfig(filePath);
    p.file = filePath;
    // hoist default configuration left to right
    return p;
  }

  static async prepare(prompt: Prompty, inputs: any = {}): Promise<any> {
    const invoker = InvokerFactory.getInstance();
    inputs = utils.paramHoisting(inputs, prompt.sample);
    const render = await invoker.callRenderer(prompt, inputs, prompt.content);
    const result = await invoker.callParser(prompt, render);
    return result;
  }

  static prepareSync(prompt: Prompty, inputs: any = {}): any {
    const invoker = InvokerFactory.getInstance();
    inputs = utils.paramHoisting(inputs, prompt.sample);
    const render = invoker.callRendererSync(prompt, inputs, prompt.content);
    const result = invoker.callParserSync(prompt, render);
    return result;
  }

  static async run(prompt: Prompty, inputs: any = {}, options: ExecutionOptions = {}): Promise<any> {

    // TODO: Implement the execute method
    const invoker = InvokerFactory.getInstance();

    inputs = utils.paramHoisting(inputs, prompt.sample);

    return {};
  }



  static export(prompt: Prompty): string {
    // Object for the frontmatter attributes
    const front_matter = {
      name: prompt.name,
      description: prompt.description,
      authors: prompt.authors,
      tags: prompt.tags,
      version: prompt.version,
      base: prompt.base,
      model: prompt.model,
      sample: prompt.sample,
      input: prompt.input,
      output: prompt.output,
      template: prompt.template
    };

    const yaml_str = "---\r\n" + yaml.dump(front_matter) + "---\r\n" + prompt.content;
    return yaml_str;
  }
}