import * as nunjucks from "nunjucks";
import path from "path";

/**
 * A unified template engine that encapsulates Nunjucks setup and provides
 * a consistent API for all language emitters.
 * 
 * Features:
 * - Multiple loader paths for shared macros access
 * - Registered custom filters (camelCase, snakeCase, pascalCase, etc.)
 * - Clean render API that accepts pure data contexts (no functions)
 */
export class TemplateEngine {
  private env: nunjucks.Environment;
  private templateCache: Map<string, nunjucks.Template> = new Map();

  /**
   * Create a new TemplateEngine for a specific language.
   * 
   * @param templateDir - Base template directory (e.g., 'src/templates')
   * @param language - Language subdirectory (e.g., 'python', 'csharp')
   */
  constructor(templateDir: string, language: string) {
    const languageDir = path.resolve(templateDir, language);
    const sharedDir = path.resolve(templateDir, '_shared');

    // Configure loader with multiple paths:
    // 1. Language-specific templates first
    // 2. Shared macros second (allows {% from "macros.njk" %} without relative path)
    const loader = new nunjucks.FileSystemLoader([languageDir, sharedDir], {
      watch: false,
      noCache: false,
    });

    this.env = new nunjucks.Environment(loader, {
      autoescape: false,  // Don't escape output - we're generating code, not HTML
      trimBlocks: false,  // Don't remove newlines after block tags - we want control
      lstripBlocks: false, // Keep indentation before block tags
    });

    // Register custom filters
    this.registerFilters();
  }

  /**
   * Register custom Nunjucks filters for common transformations.
   */
  private registerFilters(): void {
    // camelCase: "hello_world" -> "helloWorld"
    this.env.addFilter('camelCase', (str: string): string => {
      if (!str) return str;
      return str
        .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
        .replace(/^(.)/, (_, char) => char.toLowerCase());
    });

    // PascalCase: "hello_world" -> "HelloWorld", "helloWorld" -> "HelloWorld"
    this.env.addFilter('pascalCase', (str: string): string => {
      if (!str) return str;
      
      // First handle snake_case and kebab-case
      if (str.includes('_') || str.includes('-')) {
        return str
          .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
          .replace(/^(.)/, (_, char) => char.toUpperCase());
      }
      
      // Handle camelCase by inserting boundaries at uppercase letters
      const withBoundaries = str.replace(/([a-z])([A-Z])/g, '$1_$2');
      return withBoundaries
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    });

    // snake_case: "helloWorld" -> "hello_world"
    this.env.addFilter('snakeCase', (str: string): string => {
      if (!str) return str;
      return str
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '');
    });

    // kebab-case: "helloWorld" -> "hello-world"
    this.env.addFilter('kebabCase', (str: string): string => {
      if (!str) return str;
      return str
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
    });

    // JSON stringify with optional formatting
    this.env.addFilter('jsonStringify', (obj: any, indent?: number): string => {
      return JSON.stringify(obj, null, indent);
    });

    // Indent each line of a string
    this.env.addFilter('indent', (str: string, spaces: number): string => {
      if (!str) return str;
      const indent = ' '.repeat(spaces);
      return str.split('\n').map(line => indent + line).join('\n');
    });

    // Wrap text in comment style
    this.env.addFilter('wrapComment', (str: string, prefix: string = '# '): string => {
      if (!str) return str;
      return str.split('\n').map(line => prefix + line).join('\n');
    });

    // Python-specific: convert boolean to Python bool
    this.env.addFilter('pythonBool', (val: boolean): string => {
      return val ? 'True' : 'False';
    });

    // Filter array by property
    this.env.addFilter('where', (arr: any[], prop: string, value: any): any[] => {
      if (!arr) return arr;
      return arr.filter(item => item[prop] === value);
    });

    // Filter array where property is truthy
    this.env.addFilter('whereTruthy', (arr: any[], prop: string): any[] => {
      if (!arr) return arr;
      return arr.filter(item => item[prop]);
    });

    // Filter array where property is falsy
    this.env.addFilter('whereFalsy', (arr: any[], prop: string): any[] => {
      if (!arr) return arr;
      return arr.filter(item => !item[prop]);
    });

    // Get unique values from array by property
    this.env.addFilter('unique', (arr: any[], prop?: string): any[] => {
      if (!arr) return arr;
      if (prop) {
        const seen = new Set();
        return arr.filter(item => {
          const val = item[prop];
          if (seen.has(val)) return false;
          seen.add(val);
          return true;
        });
      }
      return [...new Set(arr)];
    });

    // Map lookup - useful for type mapping
    this.env.addFilter('lookup', (key: string, map: Record<string, string>, defaultValue?: string): string => {
      return map[key] ?? defaultValue ?? key;
    });
  }

  /**
   * Get a template by name, with caching.
   */
  getTemplate(name: string): nunjucks.Template {
    let template = this.templateCache.get(name);
    if (!template) {
      template = this.env.getTemplate(name, true);
      this.templateCache.set(name, template);
    }
    return template;
  }

  /**
   * Render a template with the given context.
   * 
   * @param templateName - Name of the template file (e.g., 'class.njk')
   * @param context - Pure data context (no functions - all logic should be in macros)
   * @returns The rendered string
   */
  render(templateName: string, context: Record<string, any>): string {
    const template = this.getTemplate(templateName);
    return template.render(context);
  }

  /**
   * Render a template string directly (useful for inline templates).
   */
  renderString(templateStr: string, context: Record<string, any>): string {
    return this.env.renderString(templateStr, context);
  }

  /**
   * Add a custom filter to this engine instance.
   */
  addFilter(name: string, fn: (...args: any[]) => any): void {
    this.env.addFilter(name, fn);
  }

  /**
   * Add a custom global variable/function available to all templates.
   */
  addGlobal(name: string, value: any): void {
    this.env.addGlobal(name, value);
  }
}

/**
 * Factory function to create a TemplateEngine for a specific language.
 * This is the recommended way to create engines in emitters.
 */
export function createTemplateEngine(templateDir: string, language: string): TemplateEngine {
  return new TemplateEngine(templateDir, language);
}
