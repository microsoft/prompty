/**
 * Local cassette-replay HTTP transport for the service-drill vector.
 *
 * The drill binds the Executor->Processor transport seam via **base-URL
 * redirect**: the provider SDK is pointed at a local `node:http` server that
 * serves a recorded response and records the inbound request. This is the
 * consumer-owned "roster" half of the drill -- deliberately NOT modeled in
 * TypeSpec/Typra, since cassette bytes and provider-SDK transport binding stay
 * runtime-owned. It is the TypeScript counterpart of the Python runtime's
 * `tests/model/_drill_replay.py`.
 *
 * No production code changes: the executor's own connection `endpoint` is set
 * to `server.baseUrl` and its OpenAI SDK POSTs there exactly as it would to the
 * real base URL.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type CapturedRequest = {
  method: string;
  path: string;
  body: unknown;
};

/**
 * A background HTTP server that replays one response and records requests.
 *
 * `baseUrl` is the redirect target to hand the provider SDK; `lastRequest` is
 * the most recently captured outbound request (the wire plane's observed
 * value). Use `start()`/`stop()` around the transport-bound invocation.
 */
export class CassetteReplayServer {
  readonly captured: CapturedRequest[] = [];
  private server: Server | null = null;

  constructor(
    private readonly responseBody: unknown,
    private readonly responseStatus: number = 200,
  ) {}

  async start(): Promise<void> {
    const payload = JSON.stringify(this.responseBody);
    this.server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: unknown = {};
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = { __raw__: raw };
          }
        }
        this.captured.push({
          method: req.method ?? "POST",
          path: req.url ?? "/",
          body,
        });
        res.writeHead(this.responseStatus, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload).toString(),
        });
        res.end(payload);
      });
    });
    await new Promise<void>((resolveListen) => {
      this.server!.listen(0, "127.0.0.1", () => resolveListen());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolveClose) => {
      this.server!.close(() => resolveClose());
    });
    this.server = null;
  }

  get baseUrl(): string {
    if (!this.server) throw new Error("replay server not started");
    const { address, port } = this.server.address() as AddressInfo;
    const host = address === "::" ? "127.0.0.1" : address;
    return `http://${host}:${port}`;
  }

  get lastRequest(): CapturedRequest | null {
    return this.captured.length > 0
      ? this.captured[this.captured.length - 1]
      : null;
  }
}
