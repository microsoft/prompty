import { Prompty } from "./core";
import { Invoker, InvokerFactory } from "./invokerFactory";
import * as nunjucks from 'nunjucks';
import * as mustache from 'mustache'

type NunjucksRuntime = {
    contextOrFrameLookup: (context: unknown, frame: unknown, name: unknown) => unknown;
    memberLookup: (object: unknown, property: unknown) => unknown;
    callWrap: (callable: unknown, name: string, context: unknown, args: unknown[]) => unknown;
};

const UNSAFE_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

function safeMemberLookup(object: unknown, property: unknown): unknown {
    if (typeof property === "string" && UNSAFE_PROPERTIES.has(property)) {
        throw new Error(`Unsafe template member access: ${property}`);
    }

    if (
        (typeof property !== "string" && typeof property !== "number") ||
        object === null ||
        typeof object !== "object"
    ) {
        return undefined;
    }

    const descriptor = Object.getOwnPropertyDescriptor(object, property);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function safeCallWrap(_callable: unknown, name: string, _context: unknown, _args: unknown[]): never {
    throw new Error(`Template function calls are not allowed: ${name}`);
}

function sanitizeValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }

    if (typeof value !== "object") {
        return undefined;
    }

    const existing = seen.get(value);
    if (existing !== undefined) {
        return existing;
    }

    if (Array.isArray(value)) {
        const result: unknown[] = [];
        seen.set(value, result);
        for (const item of value) {
            result.push(sanitizeValue(item, seen));
        }
        return result;
    }

    const result = Object.create(null) as Record<string, unknown>;
    seen.set(value, result);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!UNSAFE_PROPERTIES.has(key) && "value" in descriptor) {
            result[key] = sanitizeValue(descriptor.value, seen);
        }
    }
    return result;
}

function sanitizeInputs(inputs: unknown): Record<string, unknown> {
    const sanitized = sanitizeValue(inputs);
    return sanitized !== null && typeof sanitized === "object" && !Array.isArray(sanitized)
        ? sanitized as Record<string, unknown>
        : Object.create(null);
}

function renderSafely(template: string, inputs: Record<string, unknown>): string {
    const runtime = nunjucks.runtime as unknown as NunjucksRuntime;
    const contextOrFrameLookup = runtime.contextOrFrameLookup;
    const memberLookup = runtime.memberLookup;
    const callWrap = runtime.callWrap;
    runtime.contextOrFrameLookup = (context, frame, name) => {
        if (typeof name === "string" && UNSAFE_PROPERTIES.has(name)) {
            throw new Error(`Unsafe template member access: ${name}`);
        }
        return contextOrFrameLookup(context, frame, name);
    };
    runtime.memberLookup = safeMemberLookup;
    runtime.callWrap = safeCallWrap;

    try {
        return nunjucks.renderString(template, inputs);
    } finally {
        runtime.contextOrFrameLookup = contextOrFrameLookup;
        runtime.memberLookup = memberLookup;
        runtime.callWrap = callWrap;
    }
}

class NunjucksRenderer extends Invoker {
    private templates: Record<string, string> = {};
    //private name: string;

    async invoke(data: any): Promise<any> {
        return Promise.resolve(this.invokeSync(data));
    }

    invokeSync(data: any): any {
        return renderSafely(this.prompty.content, sanitizeInputs(data));
    }
}

class MustacheRenderer extends Invoker {
    private templates: Record<string, string> = {};
    //private name: string;

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