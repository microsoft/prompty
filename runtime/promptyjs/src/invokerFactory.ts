import {
  Prompty
} from "./core";

export abstract class Invoker {
  prompty: Prompty;

  constructor(prompty: Prompty) {
    this.prompty = prompty;
  }

  // Mark the invoke method as abstract, 
  // requiring subclasses to implement it.
  abstract invoke(data: any): Promise<any>;

  // Mark the invoke method as abstract, 
  // requiring subclasses to implement it.
  abstract invokeSync(data: any): any;

  async call(data: any): Promise<any> {
    return await this.invoke(data);
  }

  callSync(data: any): any {
    return this.invokeSync(data);
  }
}

export class NoOpInvoker extends Invoker {
  async invoke(data: any): Promise<any> {
    return Promise.resolve(data);
  }

  invokeSync(data: any): any {
    return data;
  }
}

type InvokerConstructor = new (prompty: Prompty) => Invoker

type InvokerType = "renderer" | "parser" | "executor" | "processor";

export class InvokerFactory {
  private static _instance: InvokerFactory;
  private _invokers: Record<string, Record<string, InvokerConstructor>> = {
    renderer: { ["NOOP"]: NoOpInvoker },
    parser: { ["NOOP"]: NoOpInvoker },
    executor: { ["NOOP"]: NoOpInvoker },
    processor: { ["NOOP"]: NoOpInvoker }
  };

  public register(type: InvokerType, name: string, invokerClass: InvokerConstructor): void {
    if (!this._invokers[type]) {
      throw new Error(`Invalid invoker type: ${type}`);
    }
    this._invokers[type][name] = invokerClass;
  }

  public create(type: InvokerType, name: string, prompty: Prompty): Invoker {
    const invokerClass = this._invokers[type][name];
    if (!invokerClass) {
      throw new Error(`No registered ${type} for name: ${name}`);
    }
    return new invokerClass(prompty);
  }

  private static getName(type: InvokerType, prompty: Prompty): string {
    switch (type) {
      case "renderer":
        return prompty.template.type;
      case "parser":
        return `${prompty.template.parser}.${prompty.model.api}`;
      case "executor":
        return prompty.model.configuration.type;
      case "processor":
        return prompty.model.configuration.type;
      default:
        throw new Error(`Invalid invoker type: ${type}`);
    }
  }

  public static getInstance(): InvokerFactory {
    if (!this._instance) {
      this._instance = new InvokerFactory();
    }
    return this._instance;
  }

  public async call(type: InvokerType, prompty: Prompty, data: any, alt?: any): Promise<any> {
    const name = InvokerFactory.getName(type, prompty);

    if (name.startsWith("NOOP") && alt) {
      return alt;
    } else if (name.startsWith("NOOP")) {
      return data;
    }

    const invoker = this.create(type, name, prompty);
    return await invoker.call(data);
  }

  public async callRenderer(prompty: Prompty, data: any, alt?: any): Promise<any> {
    return await this.call("renderer", prompty, data, alt);
  }

  public async callParser(prompty: Prompty, data: any, alt?: any): Promise<any> {
    return await this.call("parser", prompty, data, alt);
  }

  public async callExecutor(prompty: Prompty, data: any, alt?: any): Promise<any> {
    return await this.call("executor", prompty, data, alt);
  }

  public async callProcessor(prompty: Prompty, data: any, alt?: any): Promise<any> {
    return await this.call("processor", prompty, data, alt);
  }
  

  public callSync(type: InvokerType, prompty: Prompty, data: any, alt?: any): any {
    const name = InvokerFactory.getName(type, prompty);

    if (name.startsWith("NOOP") && alt) {
      return alt;
    } else if (name.startsWith("NOOP")) {
      return data;
    }

    const invoker = this.create(type, name, prompty);
    return invoker.callSync(data);
  }

  public callRendererSync(prompty: Prompty, data: any, alt?: any): any {
    return this.callSync("renderer", prompty, data, alt);
  }

  public callParserSync(prompty: Prompty, data: any, alt?: any): any {
    return this.callSync("parser", prompty, data, alt);
  }

  public callExecutorSync(prompty: Prompty, data: any, alt?: any): any {
    return this.callSync("executor", prompty, data, alt);
  }

  public callProcessorSync(prompty: Prompty, data: any, alt?: any): any {
    return this.callSync("processor", prompty, data, alt);
  }


  public toDict(): Record<string, Record<string, string>> {
    const dict: Record<string, Record<string, string>> = {};

    // Iterate over each category (renderers, parsers, executors, processors)
    for (const [type, invokers] of Object.entries(this._invokers)) {
      // Convert each invoker class to its name
      dict[type] = Object.fromEntries(
        Object.entries(invokers).map(([key, value]) => [key, value.name])
      );
    }

    return dict;
  }

  public toJson(): string {
    return JSON.stringify(this.toDict());
  }
}