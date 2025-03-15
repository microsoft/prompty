// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface Console {
  info(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export class Logger {
  constructor(private console: Console) {}

  info(message: string) {
    this.console.info(message);
  }

  error(message: string) {
    this.console.error(message);
  }

  warn(message: string) {
    this.console.warn(message);
  }

  debug(message: string) {
    this.console.debug(message);
  }
}
