import * as path from 'path';
import { Prompty } from './core';
import { Invoker, InvokerFactory, NoOpInvoker } from "./invokerFactory";
import { utils } from './utils';
import { ChatCompletionContentPart, ChatCompletionContentPartImage, ChatCompletionMessageParam } from 'openai/resources';

type ROLE = "assistant" | "function" | "system" | "user"
class PromptyChatParser extends Invoker {
  private roles: ROLE[];

  constructor(prompty: Prompty) {
    super(prompty)
    this.roles = ["assistant", "function", "system", "user"];
  }

  private async inlineImage(imageItem: string): Promise<string> {
    if (imageItem.startsWith("http") || imageItem.startsWith("data")) {
      return imageItem;
    } else {
      if (utils.isNode) {
        const imagePath = path.join(path.dirname(this.prompty.file), imageItem);
        const fileContent = await utils.readFileSafe(imagePath, 'base64');
        const extension = path.extname(imagePath).toLowerCase();
        switch (extension) {
          case '.png':
            return `data:image/png;base64,${fileContent}`;
          case '.jpg':
          case '.jpeg':
            return `data:image/jpeg;base64,${fileContent}`;
          default:
            throw new Error(`Invalid image format ${extension} - currently only .png and .jpg/.jpeg are supported.`);
        }
      } else {
        throw new Error("Load from file not supported in browser")
      }
    }
  }

  public async parseContent(content: string, role: ROLE): Promise<Array<ChatCompletionContentPart>> {
    // Normalize line endings
    const imageRegex = /!\[(.*?)\]\((.*?)\)/gm;
    let matches;
    let contentItems: Array<ChatCompletionContentPart> = [];
    let contentChunks = content.split(imageRegex);

    for (let index = 0; index < contentChunks.length; index++) {
      const chunk = contentChunks[index]
      if (index % 3 === 0 && chunk.trim()) {
        contentItems.push({ type: "text", text: chunk.trim() });
      } else if (index % 3 === 2) {
        const base64Str = await this.inlineImage(chunk.split(" ")[0].trim())
        let msg: ChatCompletionContentPartImage = {
          type: "image_url",
          image_url: { url: base64Str }
        }

        contentItems.push(msg);
      }
    }

    return contentItems;
  }

  public invokeSync(data: any) {
    throw new Error("Not Supported")
  }

  public async invoke(data: any): Promise<any> {
    let messages: any[] = [];
    const separator = new RegExp(`\\s*#?\\s*(${this.roles.join("|")})\\s*:\\s*\\n`, "im");

    let chunks = data.replaceAll("\r\n", "\n")   // normalize line endings
                      .split(separator)
                      .filter((chunk: string) => chunk.trim());

    if (!this.roles.includes(chunks[0].trim().toLowerCase())) {
      chunks.unshift("system");
    }

    if (this.roles.includes(chunks[chunks.length - 1].trim().toLowerCase())) {
      chunks.pop();
    }

    if (chunks.length % 2 !== 0) {
      throw new Error("Invalid prompt format");
    }

    for (let i = 0; i < chunks.length; i += 2) {
      const role = chunks[i].trim().toLowerCase() as ROLE;
      const content = chunks[i + 1].trim();
      const parsedContent = await this.parseContent(content, role)

      // backward compatible for models inference runtime that just supports content as a string.
      // for example ollama, ai toolkit for VSCode
      if (parsedContent.length == 1 && parsedContent[0].type == "text") {
        messages.push({ role, content: parsedContent[0].text });
      }
      else {
        messages.push({ role, content: parsedContent });
      }
    }

    return messages;
  }
}

const factory = InvokerFactory.getInstance();
factory.register("parser", "prompty.chat", PromptyChatParser);
factory.register("parser", "prompty.embedding", NoOpInvoker);
factory.register("parser", "prompty.image", NoOpInvoker);
factory.register("parser", "prompty.completion", NoOpInvoker);