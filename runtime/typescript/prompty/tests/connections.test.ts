import { describe, it, expect, beforeEach } from "vitest";
import {
  registerConnection,
  getConnection,
  clearConnections,
} from "../src/core/connections.js";

describe("Connection Registry", () => {
  beforeEach(() => {
    clearConnections();
  });

  it("registers and retrieves a connection", () => {
    const client = { type: "openai" };
    registerConnection("test", client);
    expect(getConnection("test")).toBe(client);
  });

  it("throws for missing connection", () => {
    expect(() => getConnection("nonexistent")).toThrow(/not registered/);
  });

  it("clearConnections removes all", () => {
    registerConnection("a", {});
    registerConnection("b", {});
    clearConnections();
    expect(() => getConnection("a")).toThrow();
    expect(() => getConnection("b")).toThrow();
  });
});
