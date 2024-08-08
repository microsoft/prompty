import * as path from 'path';
import * as fs from 'fs';
import { trace as otelTrace, Tracer, Span, SpanExporter, SpanProcessor, BasicTracerProvider, ReadableSpan, SpanExportResult } from '@opentelemetry/sdk-trace-base';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';

const _traceName = "prompty";

function checkTracer(tracer: Tracer) {
  // Assuming check implementation specific to your setup
  // Here we simply get the tracer and ensure it’s not undefined or a placeholder
  if (!tracer) {
    initializeTracer();
  }
}

function initializeTracer(
  outputDir: string | null = null,
  spanExporters?: SpanExporter | SpanExporter[]
): void {
  const resource = new Resource({ "service.name": _traceName });
  const provider = new BasicTracerProvider({ resource });
  let exporters: SpanExporter[] = [];

  if (spanExporters) {
    exporters = Array.isArray(spanExporters) ? spanExporters : [spanExporters];
  }

  if (outputDir) {
    exporters.push(new PromptySpanExporter(outputDir));
  }

  exporters.forEach(exporter => {
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  });

  otelTrace.setGlobalTracerProvider(provider);
}

function currentSpan(): Span {
  const tracer = currentTracer();
  return otelTrace.getActiveSpan();
}

function currentTracer(): Tracer {
  const tracer = otelTrace.getTracer(_traceName);
  checkTracer(tracer);
  return tracer;
}

class PromptySpanProcessor implements SpanProcessor {
  private spans: ReadableSpan[] = [];
  constructor(private spanExporters: SpanExporter[]) {}

  onStart(span: Span): void {}

  onEnd(span: ReadableSpan): void {
    this.spans.push(span);
    this.spanExporters.forEach(exporter => {
      if (!(exporter instanceof PromptySpanExporter)) {
        exporter.export([span]);
      }
    });
  }

  shutdown(): void {
    this.spanExporters.forEach(exporter => {
      if (exporter instanceof PromptySpanExporter) {
        exporter.export(this.spans);
      }
    });
  }

  forceFlush(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class PromptySpanExporter implements SpanExporter {
  private root: string;

  constructor(outputDir: string | null = null) {
    this.root = outputDir ? path.resolve(outputDir) : path.resolve('.runs');
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
  }

  export(spans: ReadableSpan[]): Promise<SpanExportResult> {
    const traceData = spans.map(span => JSON.parse(span.toString()));
    const traceFile = path.join(this.root, `trace.${new Date().toISOString()}.ptrace`);
    fs.writeFileSync(traceFile, JSON.stringify(traceData, null, 2));
    return Promise.resolve(SpanExportResult.SUCCESS);
  }

  forceFlush(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

function trace(func: Function, description: string = ""): Function {
  return function (...args: any[]) {
    const tracer = currentTracer();
    const span = tracer.startSpan(func.name);

    try {
      const result = func.apply(this, args);
      span.end();
      return result;
    } catch (error) {
      span.recordException(error);
      span.end();
      throw error;
    }
  };
}
