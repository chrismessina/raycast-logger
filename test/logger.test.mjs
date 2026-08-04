import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";

// The package intentionally peers on @raycast/api, which has no loadable Node
// runtime in this test environment. Stub only the preference call while loading
// the compiled CommonJS module; production resolution is unchanged.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@raycast/api") {
    return { getPreferenceValues: () => ({ verboseLogging: false }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const require = createRequire(import.meta.url);
const publicApi = require("../dist/index.js");
const { Logger } = publicApi;
Module._load = originalLoad;

function captureConsole(method, action) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => calls.push(args);
  try {
    action();
  } finally {
    console[method] = original;
  }
  return calls;
}

test("package root: preserves the documented runtime API", () => {
  assert.equal(typeof publicApi.Logger, "function");
  assert.equal(typeof publicApi.logger, "object");
  assert.equal(typeof publicApi.redactString, "function");
  assert.equal(typeof publicApi.sanitizeArgs, "function");
});

test("Logger: verbose methods remain gated", () => {
  const logger = new Logger({ isVerboseEnabled: () => false, colorize: false });
  const calls = captureConsole("log", () => logger.log("hidden"));
  assert.deepEqual(calls, []);
});

test("Logger: always-visible methods redact messages and structured args", () => {
  const logger = new Logger({ isVerboseEnabled: () => false, colorize: false });
  const calls = captureConsole("error", () =>
    logger.error("token: secret", { apple_password: "hunter2", code: "ENOENT" }),
  );
  assert.deepEqual(calls, [["[ERROR]", "token: ***", { apple_password: "***", code: "ENOENT" }]]);
});

test("Logger: child loggers preserve configuration and compose prefixes", () => {
  const logger = new Logger({ prefix: "[Parent]", isVerboseEnabled: () => true, colorize: false });
  const calls = captureConsole("log", () => logger.child("[Child]").log("ready"));
  assert.deepEqual(calls, [["[Parent] [Child] ready"]]);
});

test("Logger: inspect fails closed for circular objects", () => {
  const logger = new Logger({ isVerboseEnabled: () => true, colorize: false });
  const circular = { password: "hunter2" };
  circular.self = circular;

  const calls = captureConsole("log", () => logger.inspect("payload", circular));
  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls.flat().join("\n"), /hunter2/);
  assert.match(calls[1][0], /withheld/);
});

test("Logger: a throwing verbosity callback cannot crash the caller or leak its error", () => {
  const logger = new Logger({
    isVerboseEnabled: () => {
      throw new Error("token=secret");
    },
    colorize: false,
  });

  const calls = captureConsole("error", () => assert.doesNotThrow(() => logger.log("message")));
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(calls), /token=secret/);
  assert.match(JSON.stringify(calls), /token=\*\*\*/);
});
