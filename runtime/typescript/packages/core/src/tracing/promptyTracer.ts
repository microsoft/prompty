/**
 * File-writing tracer backend — writes hierarchical `.tracy` JSON files.
 *
 * Mirrors the Python `PromptyTracer`: captures timing, usage metrics,
 * and nested call frames, then writes a `.tracy` file on root span completion.
 *
 * @module
 */

import * as fs from "fs";
import * as path from "path";
import type { TracerFactory, TracerBackend } from "./tracer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TraceFrame {
  name: string;
  __time: {
    start: Date;
    end?: Date;
    duration?: number;
  };
  [key: string]: unknown;
  __frames?: TraceFrame[];
  __usage?: Record<string, number>;
}

interface TracyFile {
  runtime: string;
  version: string;
  trace: unknown;
}

// ---------------------------------------------------------------------------
// PromptyTracer
// ---------------------------------------------------------------------------

/**
 * JSON file trace backend that writes `.tracy` files to disk.
 *
 * Each completed root span is written as a `.tracy` file in the configured
 * output directory, using the format: `{spanName}.{YYYYMMDD.HHMMSS}.tracy`
 *
 * @example
 * ```ts
 * import { Tracer } from "@prompty/core";
 * import { PromptyTracer } from "@prompty/core";
 *
 * const pt = new PromptyTracer({ outputDir: "./.runs" });
 * Tracer.add("prompty", pt.factory);
 * ```
 */
export class PromptyTracer {
  private outputDir: string;
  private version: string;
  private stack: TraceFrame[] = [];

  /** The path of the last written `.tracy` file, if any. */
  public lastTracePath: string | undefined;

  constructor(options?: { outputDir?: string; version?: string }) {
    this.outputDir = options?.outputDir
      ? path.resolve(options.outputDir)
      : path.resolve(process.cwd(), ".runs");
    this.version = options?.version ?? "2.0.0";

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * The tracer factory — pass this to `Tracer.add()`.
   *
   * Arrow function so `this` is bound correctly.
   */
  factory: TracerFactory = (signature: string): TracerBackend => {
    // Push a new frame for this span
    const frame: TraceFrame = {
      name: signature,
      __time: { start: new Date() },
    };
    this.stack.push(frame);

    return (key: string, value: unknown): void => {
      if (key === "__end__") {
        this.endSpan(frame);
        return;
      }

      // Accumulate key/value pairs on the frame
      if (key in frame) {
        const existing = frame[key];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          frame[key] = [existing, value];
        }
      } else {
        frame[key] = value;
      }
    };
  };

  private endSpan(frame: TraceFrame): void {
    // Pop from stack (find and remove this specific frame)
    const idx = this.stack.lastIndexOf(frame);
    if (idx >= 0) {
      this.stack.splice(idx, 1);
    }

    // Compute timing
    const start = frame.__time.start;
    const end = new Date();
    const duration = end.getTime() - start.getTime();

    frame.__time = {
      start: start,
      end: end,
      duration,
    };

    // Hoist usage from result
    if (frame.result && typeof frame.result === "object" && !Array.isArray(frame.result)) {
      const result = frame.result as Record<string, unknown>;
      if (result.usage && typeof result.usage === "object") {
        frame.__usage = this.hoistUsage(result.usage as Record<string, unknown>, frame.__usage ?? {});
      }
    }

    // Hoist usage from array results (streaming)
    if (Array.isArray(frame.result)) {
      for (const item of frame.result) {
        if (item && typeof item === "object" && "usage" in item) {
          const r = item as Record<string, unknown>;
          if (r.usage && typeof r.usage === "object") {
            frame.__usage = this.hoistUsage(r.usage as Record<string, unknown>, frame.__usage ?? {});
          }
        }
      }
    }

    // Aggregate usage from child frames
    if (frame.__frames) {
      for (const child of frame.__frames) {
        if (child.__usage) {
          frame.__usage = this.hoistUsage(child.__usage, frame.__usage ?? {});
        }
      }
    }

    // Root frame — write to disk
    if (this.stack.length === 0) {
      this.writeTrace(frame);
    } else {
      // Nested — append to parent's __frames
      const parent = this.stack[this.stack.length - 1];
      if (!parent.__frames) {
        parent.__frames = [];
      }
      parent.__frames.push(frame);
    }
  }

  private hoistUsage(
    src: Record<string, unknown>,
    cur: Record<string, number>,
  ): Record<string, number> {
    for (const [key, value] of Object.entries(src)) {
      if (value === null || value === undefined || typeof value === "object") continue;
      if (typeof value === "number") {
        cur[key] = (cur[key] ?? 0) + value;
      }
    }
    return cur;
  }

  private writeTrace(frame: TraceFrame): void {
    const now = new Date();
    const dateStr = [
      now.getFullYear().toString(),
      (now.getMonth() + 1).toString().padStart(2, "0"),
      now.getDate().toString().padStart(2, "0"),
    ].join("");
    const timeStr = [
      now.getHours().toString().padStart(2, "0"),
      now.getMinutes().toString().padStart(2, "0"),
      now.getSeconds().toString().padStart(2, "0"),
    ].join("");

    const fileName = `${this.sanitizeName(frame.name)}.${dateStr}.${timeStr}.tracy`;
    const filePath = path.join(this.outputDir, fileName);

    // Serialize dates to ISO strings for the output
    const serializedFrame = this.serializeFrame(frame);

    const tracyFile: TracyFile = {
      runtime: "typescript",
      version: this.version,
      trace: serializedFrame,
    };

    fs.writeFileSync(filePath, JSON.stringify(tracyFile, null, 4), "utf-8");
    this.lastTracePath = filePath;
  }

  private serializeFrame(frame: TraceFrame): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(frame)) {
      if (key === "__time") {
        const t = value as TraceFrame["__time"];
        result.__time = {
          start: this.formatDateTime(t.start),
          end: t.end ? this.formatDateTime(t.end) : undefined,
          duration: t.duration,
        };
      } else if (key === "__frames" && Array.isArray(value)) {
        result.__frames = value.map((f: TraceFrame) => this.serializeFrame(f));
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /** Format a Date to match the Python PromptyTracer format: `YYYY-MM-DDTHH:MM:SS.ffffff` */
  private formatDateTime(date: Date): string {
    const y = date.getFullYear();
    const mo = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    const h = date.getHours().toString().padStart(2, "0");
    const mi = date.getMinutes().toString().padStart(2, "0");
    const s = date.getSeconds().toString().padStart(2, "0");
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}000`;
  }

  private sanitizeName(name: string): string {
    // Replace anything not alphanumeric, dash, or underscore with underscore
    return name.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
}
