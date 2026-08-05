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

test("Logger: inspect marks the cycle without leaking, and keeps the rest diagnostic", () => {
  const logger = new Logger({ isVerboseEnabled: () => true, colorize: false });
  const circular = { password: "hunter2", userId: 42 };
  circular.self = circular;

  const calls = captureConsole("log", () => logger.inspect("payload", circular));
  assert.equal(calls.length, 3);
  // The security property: the credential never reaches the console.
  assert.doesNotMatch(calls.flat().join("\n"), /hunter2/);
  assert.match(calls[1][0], /"password": "\*\*\*"/);
  // The cyclic edge is marked rather than withholding the whole object, so
  // sibling fields stay readable. v1.2.4 withheld everything on any cycle.
  assert.match(calls[1][0], /"self": "\[Circular\]"/);
  assert.match(calls[1][0], /"userId": 42/);
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

// ---------------------------------------------------------------------------
// Regressions from the 2026-08-04 adversarial review of 8cef6e3.
// ---------------------------------------------------------------------------

test("regression: an interpolated prefix is redacted before formatting", () => {
  // The prefix reaches the console outside processLogData, so it printed raw
  // while the message beside it was masked.
  const logger = new Logger({
    prefix: "[token: PREFIX_SECRET]",
    isVerboseEnabled: () => true,
    colorize: false,
  });
  const calls = captureConsole("error", () => logger.error("boom"));
  assert.doesNotMatch(calls.flat().join(" "), /PREFIX_SECRET/);
});

test("regression: ordinary camelCase prefixes are not mangled by redaction", () => {
  // The counterweight: prefixes were originally left raw because a long
  // camelCase prefix tripped the old base64 heuristic and became "[***]".
  for (const prefix of ["[ProductHuntFrontpage]", "[GitHub]", "[OAuthTokenRefresher]"]) {
    const logger = new Logger({ prefix, isVerboseEnabled: () => true, colorize: false });
    const calls = captureConsole("error", () => logger.error("boom"));
    assert.match(calls.flat().join(" "), new RegExp(prefix.replace(/[[\]]/g, "\\$&")));
  }
});

test("regression: a step identifier is redacted before formatting", () => {
  const logger = new Logger({ isVerboseEnabled: () => true, colorize: false });
  const calls = captureConsole("log", () => logger.step("token: STEP_SECRET", "doing work"));
  assert.doesNotMatch(calls.flat().join(" "), /STEP_SECRET/);
});

test("regression: ordinary step numbers are unaffected", () => {
  const logger = new Logger({ isVerboseEnabled: () => true, colorize: false });
  const calls = captureConsole("log", () => logger.step(3, "doing work"));
  assert.match(calls.flat().join(" "), /\[Step 3\]/);
});

test("regression: enableRedaction:false still bypasses prefix and step redaction", () => {
  const logger = new Logger({
    prefix: "[token: RAW]",
    isVerboseEnabled: () => true,
    enableRedaction: false,
    colorize: false,
  });
  const calls = captureConsole("log", () => logger.step("token: RAWSTEP", "work"));
  const output = calls.flat().join(" ");
  assert.match(output, /RAW/);
  assert.match(output, /RAWSTEP/);
});
