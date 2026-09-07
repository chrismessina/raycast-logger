import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";

// Strict redaction (1.5.0): an opt-in level that masks URL query strings and
// fragments to a marker. Standard mode must stay byte-identical to 1.4.0.
//
// `dist/redaction.js` is imported directly for the pure functions. The Logger
// is loaded through a preference stub whose state is MUTABLE, because the
// preference is read per call and several tests flip it mid-test.

const prefs = { verboseLogging: true, strictRedaction: false };
let preferenceError = null;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@raycast/api") {
    return {
      getPreferenceValues: () => {
        if (preferenceError) throw preferenceError;
        return { ...prefs };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const require = createRequire(import.meta.url);
const { Logger } = require("../dist/index.js");
Module._load = originalLoad;
const { redactString, sanitizeArgs } = require("../dist/redaction.js");

const STRICT = { level: "strict" };
const STANDARD = { level: "standard" };

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

function joined(calls) {
  return calls.flat().map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ");
}

function reset() {
  prefs.verboseLogging = true;
  prefs.strictRedaction = false;
  preferenceError = null;
}

// Exact outputs from TODO.md decision 2. Each row: [input, standard, strict].
// The standard column is the 1.4.0 output, captured before any strict code
// existed, so this table also pins that standard did not move.
const URL_ROWS = [
  ["https://h/p?a=1&sid=x", "https://h/p?a=1&sid=x", "https://h/p?***"],
  ["https://h/p#sec", "https://h/p#sec", "https://h/p#***"],
  ["https://h/p?a=1#sec", "https://h/p?a=1#sec", "https://h/p?***#***"],
  ["https://h/p?", "https://h/p?", "https://h/p?***"],
  ["https://h/p?next=https://i/cb?t=1", "https://h/p?next=https://i/cb?t=1", "https://h/p?***"],
  ["https://u:s@h/p?q=1", "https://***:***@h/p?q=1", "https://***:***@h/p?***"],
  // Standard already masks a credential-named parameter; strict is a superset.
  ["https://h/p;token=x", "https://h/p;token=***", "https://h/p;token=***"],
  ["https://h/p#access_token=LEAK", "https://h/p#access_token=***", "https://h/p#***"],
];

// ---------------------------------------------------------------------------
// redactString
// ---------------------------------------------------------------------------

test("strict: redactString masks URL query and fragment to a marker (exact outputs)", () => {
  for (const [input, , strict] of URL_ROWS) {
    assert.equal(redactString(input, STRICT), strict, `input: ${input}`);
  }
});

test("strict: standard mode is byte-identical to 1.4.0, with and without the options argument", () => {
  for (const [input, standard] of URL_ROWS) {
    assert.equal(redactString(input), standard, `no options: ${input}`);
    assert.equal(redactString(input, STANDARD), standard, `explicit standard: ${input}`);
  }
});

test("strict: a URL embedded in a message keeps its surroundings and path", () => {
  const out = redactString("GET https://api.test/v1/items/abc123?page=2&sid=x -> 403", STRICT);
  assert.equal(out, "GET https://api.test/v1/items/abc123?*** -> 403");
});

test("strict: two URLs in one message are each masked in place", () => {
  const out = redactString("from https://a.test/x?u=1 to https://b.test/y#frag", STRICT);
  assert.equal(out, "from https://a.test/x?*** to https://b.test/y#***");
});

test("strict: a URL with no query or fragment is untouched", () => {
  assert.equal(redactString("GET https://h/p/q completed", STRICT), "GET https://h/p/q completed");
});

test("strict: non-URL text is unaffected by the level", () => {
  const corpus = [
    "fetch failed: ECONNREFUSED 127.0.0.1:8080",
    "GET /api/v1/lists/abc123def456ghi/bookmarks?limit=10 completed in 29.54ms",
    "what? really? yes#1",
  ];
  for (const message of corpus) {
    assert.equal(redactString(message, STRICT), message);
  }
});

test("strict: inherited extractor boundaries are pinned, not fixed", () => {
  // Pre-existing limits of the URL extractor, documented in TODO.md decision 2.
  // These pin CURRENT behavior so a later change is deliberate, not accidental.
  // An IPv6 host: `]` ends the run before the query is reached, so nothing masks.
  assert.equal(redactString("https://[::1]/p?sid=x", STRICT), "https://[::1]/p?sid=x");
  // A `)` inside the query ends the run early; only the recognized part masks.
  assert.equal(redactString("https://h/p?q=a)b&sid=x", STRICT), "https://h/p?***)b&sid=x");
});

// ---------------------------------------------------------------------------
// sanitizeArgs — the full threading chain from TODO.md decision 5
// ---------------------------------------------------------------------------

test("strict: sanitizeArgs masks a URL under an ordinary key", () => {
  const out = sanitizeArgs([{ url: "https://h/p?sid=x", status: 200 }], STRICT)[0];
  assert.deepEqual(out, { url: "https://h/p?***", status: 200 });
});

test("strict: sanitizeArgs masks a URL under an identifier key (the maskEmail-only branch)", () => {
  // `user` and `email` route through redactByKey's identifier branch, which
  // today returns maskEmail(value) without running the URL pass.
  const out = sanitizeArgs([{ user: "https://h/p?sid=x", email: "https://h/p#tok" }], STRICT)[0];
  assert.deepEqual(out, { user: "https://h/p?***", email: "https://h/p#***" });
  // Standard: unchanged (no `@`, so maskEmail is a no-op).
  const std = sanitizeArgs([{ user: "https://h/p?sid=x" }])[0];
  assert.deepEqual(std, { user: "https://h/p?sid=x" });
});

test("strict: sanitizeArgs masks a URL instance through the intrinsic href read", () => {
  const out = sanitizeArgs([new URL("https://h/p?sid=x#f")], STRICT)[0];
  assert.equal(out, "https://h/p?***#***");
});

test("strict: sanitizeArgs masks URLs inside Error name, message, and stack", () => {
  const error = new Error("failed https://h/p?sid=x");
  error.stack = "Error: failed https://h/p?sid=x\n    at https://h/s.js?v=9:1:1";
  const out = sanitizeArgs([error], STRICT)[0];
  assert.equal(out.name, "Error");
  assert.equal(out.message, "failed https://h/p?***");
  assert.equal(out.stack, "Error: failed https://h/p?***\n    at https://h/s.js?***");
});

test("strict: sanitizeArgs reaches nested objects, arrays, and error causes", () => {
  const cause = new Error("cause https://c.test/?k=1");
  const error = new Error("outer", { cause });
  const out = sanitizeArgs([{ list: [{ href: "https://h/a?x=1" }], error }], STRICT)[0];
  assert.deepEqual(out.list, [{ href: "https://h/a?***" }]);
  assert.equal(out.error.message, "outer");
  assert.equal(out.error.cause.message, "cause https://c.test/?***");
});

test("strict: sanitizeArgs does not mutate its input", () => {
  const input = { url: "https://h/p?sid=x", nested: { href: "https://h/q#f" } };
  const snapshot = JSON.stringify(input);
  // Exact output too: a mask-everything mutation would otherwise pass this.
  assert.deepEqual(sanitizeArgs([input], STRICT)[0], { url: "https://h/p?***", nested: { href: "https://h/q#***" } });
  assert.equal(JSON.stringify(input), snapshot);
});

// ---------------------------------------------------------------------------
// Leaks found by the Codex review of the first implementation
// ---------------------------------------------------------------------------

test("strict: the full URL table holds through sanitizeArgs, under plain and identifier keys", () => {
  for (const [input, , strict] of URL_ROWS) {
    const out = sanitizeArgs([{ href: input, username: input, appleid: input }], STRICT)[0];
    assert.deepEqual(out, { href: strict, username: strict, appleid: strict }, `input: ${input}`);
  }
});

test("strict: top-level functions and symbols are rendered through the walker", () => {
  // sanitizeArgs returned these untouched, so console printed the raw name.
  const url = "https://h/p?sid=x";
  const fn = function () {};
  Object.defineProperty(fn, "name", { value: url });
  const out = sanitizeArgs([Symbol(url), fn], STRICT);
  assert.deepEqual(out, ["Symbol(https://h/p?***)", "[Function: https://h/p?***]"]);
  // Standard: the same rendering, and a credential in a function name masks.
  const leaky = function () {};
  Object.defineProperty(leaky, "name", { value: "token=abc123" });
  assert.deepEqual(sanitizeArgs([leaky]), ["[Function: token=***]"]);
});

test("strict: a RegExp whose source contains a URL masks the query and keeps the escaping", () => {
  // RegExp.prototype.toString escapes every `/`, so the URL extractor could not
  // see the URL. The strict pass has to work on the unescaped form.
  const out = sanitizeArgs([new RegExp("https://h/p?sid=x")], STRICT)[0];
  assert.equal(out, "/https:\\/\\/h\\/p?***/");
  assert.equal(sanitizeArgs([{ re: /https:\/\/h\/q#frag/g }], STRICT)[0].re, "/https:\\/\\/h\\/q#***/g");
  // Standard is unchanged.
  assert.equal(sanitizeArgs([new RegExp("https://h/p?sid=x")])[0], "/https:\\/\\/h\\/p?sid=x/");
});

test("strict: the withheld marker does not interpolate a hostile toStringTag verbatim", () => {
  const hostile = {
    get x() {
      throw new Error("no");
    },
    [Symbol.toStringTag]: "https://h/p?sid=x",
  };
  // The marker is FIXED text. Redacting the tag was tried first and still
  // leaked through the extractor's known boundaries (an IPv6 host, a `)` in
  // the query), so the tag is not emitted at all.
  const MARKER = "[unserializable value — withheld to avoid logging unredacted data]";
  assert.equal(sanitizeArgs([hostile], STRICT)[0], MARKER);
  for (const tag of ["https://[::1]/p?sid=x", "https://h/p?q=a)b&sid=x", "token=abc123"]) {
    const value = { get x() { throw 1; }, [Symbol.toStringTag]: tag };
    assert.equal(sanitizeArgs([value], STRICT)[0], MARKER, tag);
    assert.equal(sanitizeArgs([value])[0], MARKER, `standard: ${tag}`);
  }
});

test("strict: a top-level function whose name getter throws is withheld, not thrown", () => {
  const f = function () {};
  Object.defineProperty(f, "name", {
    get() {
      throw new Error("name failure https://h/p?sid=x");
    },
  });
  const MARKER = "[unserializable value — withheld to avoid logging unredacted data]";
  let out;
  assert.doesNotThrow(() => {
    out = sanitizeArgs([f, "kept"], STRICT);
  });
  assert.deepEqual(out, [MARKER, "kept"]);
  // And through the logger. Note this does NOT reach inspect's own catch: the
  // guarded clone already turned the throw into the marker, so inspect just
  // renders a withheld value. Under redaction that catch has no known trigger.
  reset();
  const logger = new Logger({ isVerboseEnabled: () => true, enableRedaction: "strict", colorize: false });
  let calls;
  assert.doesNotThrow(() => {
    calls = captureConsole("info", () => logger.info("keep", f));
  });
  assert.deepEqual(calls, [["[INFO]", "keep", MARKER]]);
  const inspect = captureConsole("log", () => logger.inspect("keep", f));
  assert.equal(inspect.length, 3);
  assert.equal(inspect[1][0], MARKER);
  assert.match(inspect[0][0], /=== keep /);
});

test("strict: a RegExp with no URL keeps its exact source formatting", () => {
  // `/` inside a character class is not escaped by RegExp#toString; the strict
  // pass must not re-escape it when it changed nothing.
  for (const re of [/[/]/, /a\/b/, /(?:)/, /x/dgimsuy]) {
    const expected = String(re);
    assert.equal(sanitizeArgs([re], STRICT)[0], expected, expected);
    assert.equal(sanitizeArgs([re])[0], expected, `standard: ${expected}`);
  }
});

test("strict: property NAMES that are URLs are masked", () => {
  const out = sanitizeArgs([{ "https://h/p?sid=x": "ok", plain: 1 }], STRICT)[0];
  assert.deepEqual(out, { "https://h/p?***": "ok", plain: 1 });
  // Own properties of an Error take the same path.
  const error = new Error("e");
  error["https://h/e?tok=1"] = "v";
  assert.equal(sanitizeArgs([error], STRICT)[0]["https://h/e?***"], "v");
  // Standard: keys are left alone (a hash- or email-keyed map stays readable).
  const std = sanitizeArgs([{ "https://h/p?sid=x": "ok" }])[0];
  assert.deepEqual(std, { "https://h/p?sid=x": "ok" });
});

test("strict: Error name, errors, and own properties mask URLs", () => {
  const error = new Error("m");
  error.name = "https://h/n?sid=x";
  error.errors = [new Error("inner https://h/i?k=1")];
  error.detail = "see https://h/d#frag";
  const out = sanitizeArgs([error], STRICT)[0];
  assert.equal(out.name, "https://h/n?***");
  assert.equal(out.errors[0].message, "inner https://h/i?***");
  assert.equal(out.detail, "see https://h/d#***");
});

test("strict: credential and 2FA keys keep their standard behavior", () => {
  const out = sanitizeArgs([{ token: "https://h/p?sid=x", code: "https://h/c?x=1" }], STRICT)[0];
  assert.equal(out.token, "***");
  assert.equal(out.code, "https://h/c?***");
});

test("strict: the timer completion message masks the label's URL", () => {
  reset();
  const logger = new Logger({ isVerboseEnabled: () => true, enableRedaction: "strict", colorize: false });
  const done = logger.time("https://h/t?sid=x");
  const out = joined(captureConsole("log", () => done({ href: "https://h/m?k=1" })));
  assert.match(out, /https:\/\/h\/t\?\*\*\* completed in/, out);
  assert.match(out, /https:\/\/h\/m\?\*\*\*/, out);
});

test("strict: a throwing CUSTOM verbosity callback still honors the user's strict preference", () => {
  reset();
  prefs.strictRedaction = true;
  // The preference is readable here — only the author's callback failed — so
  // the effective level, not the configured one, applies to the diagnostic.
  const logger = new Logger({
    enableRedaction: false,
    colorize: false,
    isVerboseEnabled: () => {
      throw new Error("cb failed https://h/p?sid=x");
    },
  });
  const out = joined(captureConsole("error", () => logger.log("hidden")));
  assert.match(out, /Failed to determine verbose logging state/, out);
  assert.match(out, /cb failed https:\/\/h\/p\?\*\*\*/, out);
});

// ---------------------------------------------------------------------------
// Logger configuration
// ---------------------------------------------------------------------------

test("strict: enableRedaction 'strict' applies to message, args, prefix, step id, and inspect", () => {
  reset();
  const logger = new Logger({
    prefix: "[https://h/pre?sid=x]",
    isVerboseEnabled: () => true,
    enableRedaction: "strict",
    colorize: false,
  });

  const message = joined(captureConsole("log", () => logger.log("GET https://h/p?sid=x", { url: "https://h/a?b=1" })));
  assert.match(message, /\[https:\/\/h\/pre\?\*\*\*\]/, `prefix: ${message}`);
  assert.match(message, /GET https:\/\/h\/p\?\*\*\*/, `message: ${message}`);
  assert.match(message, /https:\/\/h\/a\?\*\*\*/, `args: ${message}`);
  assert.doesNotMatch(message, /sid=x|b=1/, `leak: ${message}`);

  const step = joined(captureConsole("log", () => logger.step("https://h/s?t=1", "work")));
  assert.match(step, /\[Step https:\/\/h\/s\?\*\*\*\]/, `step: ${step}`);
  assert.match(step, /work/, "the description must survive");

  const inspect = joined(captureConsole("log", () => logger.inspect("https://h/l?t=1", { href: "https://h/v?t=2" })));
  assert.match(inspect, /=== https:\/\/h\/l\?\*\*\* /, `inspect label: ${inspect}`);
  assert.match(inspect, /"href": "https:\/\/h\/v\?\*\*\*"/, `inspect value: ${inspect}`);
});

test("strict: enableRedaction true and 'standard' are the same level", () => {
  reset();
  for (const enableRedaction of [true, "standard"]) {
    const logger = new Logger({ isVerboseEnabled: () => true, enableRedaction, colorize: false });
    const out = joined(captureConsole("log", () => logger.log("bearer abc123 at https://h/p?sid=x")));
    assert.match(out, /bearer \*\*\*/, `bearer must still mask under ${enableRedaction}`);
    assert.match(out, /https:\/\/h\/p\?sid=x/, `query must survive under ${enableRedaction}: ${out}`);
  }
});

test("strict: enableRedaction false still returns raw output", () => {
  reset();
  const logger = new Logger({ isVerboseEnabled: () => true, enableRedaction: false, colorize: false });
  const out = joined(captureConsole("log", () => logger.log("https://h/p?sid=x", { url: "https://h/a?b=1" })));
  assert.match(out, /https:\/\/h\/p\?sid=x/);
  assert.match(out, /https:\/\/h\/a\?b=1/);
  assert.doesNotMatch(out, /\*\*\*/);
});

// ---------------------------------------------------------------------------
// The strictRedaction user preference — TODO.md decision 4
// ---------------------------------------------------------------------------

test("strict: the preference overrides a configured 'standard'", () => {
  reset();
  prefs.strictRedaction = true;
  const logger = new Logger({ isVerboseEnabled: () => true, enableRedaction: "standard", colorize: false });
  const out = joined(captureConsole("log", () => logger.log("GET https://h/p?sid=x", { url: "https://h/a?b=1" })));
  assert.match(out, /GET https:\/\/h\/p\?\*\*\*/, out);
  assert.match(out, /https:\/\/h\/a\?\*\*\*/, out);
});

test("strict: the preference overrides a configured false — the user's floor wins", () => {
  reset();
  prefs.strictRedaction = true;
  const logger = new Logger({
    prefix: "[https://h/pre?sid=x]",
    isVerboseEnabled: () => true,
    enableRedaction: false,
    colorize: false,
  });
  const out = joined(captureConsole("log", () => logger.log("GET https://h/p?sid=x", { url: "https://h/a?b=1" })));
  assert.match(out, /\[https:\/\/h\/pre\?\*\*\*\]/, `prefix: ${out}`);
  assert.match(out, /GET https:\/\/h\/p\?\*\*\*/, `message: ${out}`);
  assert.match(out, /https:\/\/h\/a\?\*\*\*/, `args: ${out}`);
  const step = joined(captureConsole("log", () => logger.step("https://h/s?t=1", "work")));
  assert.match(step, /\[Step https:\/\/h\/s\?\*\*\*\]/, `step: ${step}`);
  const inspect = joined(captureConsole("log", () => logger.inspect("https://h/l?t=1", { href: "https://h/v?t=2" })));
  assert.match(inspect, /https:\/\/h\/l\?\*\*\*/, `inspect label: ${inspect}`);
  assert.match(inspect, /https:\/\/h\/v\?\*\*\*/, `inspect value: ${inspect}`);
});

test("strict: a preference read failure falls back to the configured level — including false", () => {
  reset();
  preferenceError = new Error("prefs unavailable");
  const strict = new Logger({ isVerboseEnabled: () => true, enableRedaction: "strict", colorize: false });
  const s = joined(captureConsole("log", () => strict.log("https://h/p?sid=x")));
  assert.match(s, /https:\/\/h\/p\?\*\*\*/, `configured strict must hold: ${s}`);

  const off = new Logger({ isVerboseEnabled: () => true, enableRedaction: false, colorize: false });
  const o = joined(captureConsole("log", () => off.log("https://h/p?sid=x")));
  assert.match(o, /https:\/\/h\/p\?sid=x/, `configured false is honored on fallback: ${o}`);
  assert.doesNotMatch(o, /\*\*\*/);
});

test("strict: the preference-error diagnostic itself uses the configured level", () => {
  reset();
  // No isVerboseEnabled override, so defaultVerboseCheck reads the preference,
  // which throws an error carrying a URL. That error is logged via
  // sanitizeArgs([error]) outside processLogData — it must still honor strict.
  preferenceError = new Error("boom https://h/p?sid=x");
  const logger = new Logger({ enableRedaction: "strict", colorize: false });
  const calls = captureConsole("error", () => logger.log("hidden"));
  const out = joined(calls);
  assert.match(out, /Failed to read preferences/, out);
  assert.match(out, /boom https:\/\/h\/p\?\*\*\*/, out);
  assert.doesNotMatch(out, /sid=x/, out);
});

test("strict: a child created before the preference flips observes the flip on its next call", () => {
  reset();
  const parent = new Logger({ isVerboseEnabled: () => true, enableRedaction: "standard", colorize: false });
  const child = parent.child("[child]");
  const before = joined(captureConsole("log", () => child.log("https://h/p?sid=x")));
  assert.match(before, /https:\/\/h\/p\?sid=x/, before);
  prefs.strictRedaction = true;
  const after = joined(captureConsole("log", () => child.log("https://h/p?sid=x")));
  assert.match(after, /\[child\] https:\/\/h\/p\?\*\*\*/, after);
});

test("strict: two loggers at different levels do not leak into each other", () => {
  reset();
  const strict = new Logger({ isVerboseEnabled: () => true, enableRedaction: "strict", colorize: false });
  const standard = new Logger({ isVerboseEnabled: () => true, enableRedaction: "standard", colorize: false });
  for (let i = 0; i < 3; i += 1) {
    const s = joined(captureConsole("log", () => strict.log("https://h/p?sid=x")));
    const n = joined(captureConsole("log", () => standard.log("https://h/p?sid=x")));
    assert.match(s, /https:\/\/h\/p\?\*\*\*/, `strict round ${i}: ${s}`);
    assert.match(n, /https:\/\/h\/p\?sid=x/, `standard round ${i}: ${n}`);
  }
});
