import { Prompty } from "./core";
import { Invoker, InvokerFactory } from "./invokerFactory";
import * as nunjucks from 'nunjucks';
import * as mustache from 'mustache'

class NunjucksRenderer extends Invoker {
    private templates: Record<string, string> = {};
    private name: string;

    async invoke(data: any): Promise<any> {
        return Promise.resolve(this.invokeSync(data));
    }

    invokeSync(data: any): any {
        return nunjucks.renderString(this.prompty.content, data);
    }
}

class MustacheRenderer extends Invoker {
    private templates: Record<string, string> = {};
    private name: string;

    async invoke(data: any): Promise<any> {
        return Promise.resolve(this.invokeSync(data));
    }

    invokeSync(data: any): any {
        return mustache.render(this.prompty.content, data);
    }
}

// Registration
const factory = InvokerFactory.getInstance();
factory.register("renderer", "jinja2", NunjucksRenderer);
factory.register("renderer", "mustache", MustacheRenderer);