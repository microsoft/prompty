/**
 * Mustache renderer — logic-less template rendering.
 *
 * @module
 */

import Mustache from "mustache";
import type { Prompty } from "../model/prompty.js";
import type { Renderer } from "../core/interfaces.js";
import { prepareRenderInputs } from "./common.js";

export class MustacheRenderer implements Renderer {
  async render(
    agent: Prompty,
    template: string,
    inputs: Record<string, unknown>,
  ): Promise<string> {
    const [modified] = prepareRenderInputs(agent, inputs);
    return Mustache.render(template, modified);
  }
}
