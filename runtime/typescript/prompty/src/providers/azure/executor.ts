/**
 * Azure OpenAI executor — extends OpenAI executor with Azure-specific client.
 *
 * @module
 */

import OpenAI, { AzureOpenAI } from "openai";
import type { PromptAgent } from "agentschema";
import { ApiKeyConnection, ReferenceConnection } from "agentschema";
import { getConnection } from "../../core/connections.js";
import { OpenAIExecutor } from "../openai/executor.js";

export class AzureExecutor extends OpenAIExecutor {
  protected override resolveClient(agent: PromptAgent): OpenAI {
    const conn = agent.model?.connection;

    if (conn instanceof ReferenceConnection) {
      return getConnection(conn.name) as OpenAI;
    }

    const kwargs = this.clientKwargs(agent);
    return new AzureOpenAI(kwargs as ConstructorParameters<typeof AzureOpenAI>[0]);
  }

  protected override clientKwargs(agent: PromptAgent): Record<string, unknown> {
    const kwargs: Record<string, unknown> = {};
    const conn = agent.model?.connection;

    if (conn instanceof ApiKeyConnection) {
      if (conn.apiKey) kwargs.apiKey = conn.apiKey;
      if (conn.endpoint) kwargs.endpoint = conn.endpoint;
    }

    // Azure requires deployment = model id
    kwargs.deployment = agent.model?.id;

    return kwargs;
  }
}
