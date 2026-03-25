/**
 * Nunjucks renderer — Jinja2-compatible template rendering for TypeScript.
 *
 * Nunjucks is the standard Jinja2-compatible engine for Node.js.
 * This renderer replaces thread-kind inputs with nonce markers
 * before rendering.
 *
 * @module
 */

import nunjucks from "nunjucks";
import type { Prompty } from "../model/prompty.js";
import type { Renderer } from "../core/interfaces.js";
import { prepareRenderInputs } from "./common.js";

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: false,
});

export class NunjucksRenderer implements Renderer {
  async render(
    agent: Prompty,
    template: string,
    inputs: Record<string, unknown>,
  ): Promise<string> {
    const [modified] = prepareRenderInputs(agent, inputs);
    return env.renderString(template, modified);
  }
}
