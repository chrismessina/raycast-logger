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
  // Every gated method, not just log() — gating removed from debug/step/inspect
  // individually would otherwise go unnoticed.
  const logger = new Logger({ isVerboseEnabled: () => false, colorize: false });
  assert.deepEqual(captureConsole("log", () => logger.log("hidden")), []);
  assert.deepEqual(captureConsole("debug", () => logger.debug("hidden")), []);
  assert.deepEqual(captureConsole("log", () => logger.step(1, "hidden")), []);
  assert.deepEqual(captureConsole("log", () => logger.inspect("hidden", { a: 1 })), []);
  assert.deepEqual(captureConsole("log", () => logger.time("hidden")()), []);
});

test("Logger: methods that ignore the preference each still emit", () => {
  // error() was the only one covered; gating warn() or info() passed silently.
  const logger = new Logger({ isVerboseEnabled: () => false, colorize: false });
  assert.equal(captureConsole("error", () => logger.error("e")).length, 1);
  assert.equal(captureConsole("warn", () => logger.warn("w")).length, 1);
  assert.equal(captureConsole("info", () => logger.info("i")).length, 1);
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
  const output = calls.flat().join(" ");
  // Absence alone would pass if the logger suppressed output entirely.
  assert.equal(calls.length, 1, "the log line must still be emitted");
  assert.doesNotMatch(output, /PREFIX_SECRET/);
  assert.match(output, /token: \*\*\*/, `prefix must be masked, not dropped: ${output}`);
  assert.match(output, /boom/, "the message must survive");
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
  const output = calls.flat().join(" ");
  assert.equal(calls.length, 1, "the step line must still be emitted");
  assert.doesNotMatch(output, /STEP_SECRET/);
  assert.match(output, /token: \*\*\*/, `step id must be masked, not dropped: ${output}`);
  assert.match(output, /doing work/, "the description must survive");
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
  // Assert the PREFIX specifically. A bare /RAW/ was satisfied by "RAWSTEP",
  // so always-redacting the prefix would have passed this test.
  assert.match(output, /\[token: RAW\]/, `prefix must stay raw: ${output}`);
  assert.match(output, /\[Step token: RAWSTEP\]/, `step must stay raw: ${output}`);
  assert.doesNotMatch(output, /\*\*\*/, "nothing should be masked when redaction is off");
});
