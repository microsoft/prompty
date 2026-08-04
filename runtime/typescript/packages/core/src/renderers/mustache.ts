/**
 * Mustache renderer — logic-less template rendering.
 *
 * @module
 */

import Mustache from "mustache";
import type { Prompty } from "../model/agent/prompty.js";
import type { Renderer } from "../core/interfaces.js";

export class MustacheRenderer implements Renderer {
  async render(
    _agent: Prompty,
    template: string,
    inputs: Record<string, unknown>,
  ): Promise<string> {
    return Mustache.render(template, inputs);
  }
}
