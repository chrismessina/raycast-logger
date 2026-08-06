import assert from "node:assert/strict";
import { test } from "node:test";

// Import the LEAF module, not the barrel: `index.js` re-exports `logger.js`, which
// requires `@raycast/api` — a package with no loadable runtime outside Raycast.
// The redaction functions are pure TypeScript and must stay testable without it.
import { redactByKey, redactString, redactValueByKey, sanitizeArgs } from "../dist/redaction.js";

// ---------------------------------------------------------------------------
// redactString — one masked input and one near-miss for every rule in the file.
// ---------------------------------------------------------------------------

test("redactString: masks email local-parts, keeping the first char and domain", () => {
  assert.equal(redactString("Contact me at user@example.com"), "Contact me at u***@example.com");
  assert.equal(redactString("chris.messina+tag@gmail.com"), "c***@gmail.com");
});

test("redactString: text that merely contains an @ is not an email", () => {
  assert.equal(redactString("meet @ noon"), "meet @ noon");
  assert.equal(redactString("no email here at all"), "no email here at all");
});

test("redactString: masks bearer tokens", () => {
  const out = redactString("Bearer abc123xyz789");
  assert.doesNotMatch(out, /abc123xyz789/);
  assert.match(out, /Bearer \*\*\*/);
});

test("redactString: a word merely starting with 'bearer' is not a token", () => {
  assert.equal(redactString("bearerings are round"), "bearerings are round");
});

test("redactString: masks labeled key/value secrets", () => {
  assert.equal(redactString("password=hunter2"), "password=***");
  assert.equal(redactString("token: abc"), "token: ***");
  assert.equal(redactString("secret : topsecret"), "secret : ***");
  assert.doesNotMatch(redactString("api_key: sk_live_abcd1234"), /sk_live_abcd1234/);
});

test("redactString: preserves structured delimiters, whitespace, and quotes", () => {
  assert.equal(redactString('"token": "abc"'), '"token": "***"');
  assert.equal(redactString('"token": "two word secret"'), '"token": "***"');
  assert.equal(redactString('"token": "abc\\\"def"'), '"token": "***"');
  assert.equal(redactString("password = 'hunter2'"), "password = '***'");
  assert.equal(redactString("auth: value, status: 401"), "auth: ***, status: 401");
  assert.equal(redactString("request(token: secret)"), "request(token: ***)");
});

test("redactString: a label-like word with no value delimiter is left alone", () => {
  assert.equal(redactString("the password field is empty"), "the password field is empty");
  assert.equal(redactString("rotate your token soon"), "rotate your token soon");
});

test("redactString: masks labeled 2FA/OTP codes", () => {
  assert.equal(redactString("code: 123456"), "code: ******");
  assert.equal(redactString("code=123456"), "code=******");
  assert.equal(redactString("otp: 4321"), "otp: ******");
  assert.equal(redactString("2fa: 5678"), "2fa: ******");
  assert.equal(redactString("two-factor: 999999"), "two-factor: ******");
  assert.equal(redactString("two factor: 999999"), "two factor: ******");
});

test("redactString: a labeled value too short to be a 2FA code is left alone", () => {
  assert.equal(redactString("code: 12"), "code: 12");
  assert.equal(redactString("otp: 7"), "otp: 7");
});

test("redactString: masks long hex strings that look like hashes or tokens", () => {
  assert.equal(redactString("hash 0123456789abcdef0123456789abcdef"), "hash ***");
});

test("redactString: a short hex string is not a token", () => {
  assert.equal(redactString("short hex 0123abcd"), "short hex 0123abcd");
  assert.equal(redactString("commit deadbeef"), "commit deadbeef");
});

test("redactString: masks long base64-like runs", () => {
  assert.doesNotMatch(redactString("blob QUJDREVGR0hJSktMTU5PUFFSU1Q="), /QUJDREVGR0hJSktMTU5PUFFSU1Q/);
});

test("redactString: an ordinary short word is not base64", () => {
  assert.equal(redactString("downloading"), "downloading");
  assert.equal(redactString("ECONNREFUSED"), "ECONNREFUSED");
});

test("redactString: long decimal IDs and plain words are not base64", () => {
  assert.equal(redactString("order 12345678901234567890123456"), "order 12345678901234567890123456");
  assert.equal(redactString("antidisestablishmentarianism"), "antidisestablishmentarianism");
});

test("redactString: pure decimal IDs are not mistaken for hex", () => {
  const id = "1234567890123456789012345678901234567890";
  assert.equal(redactString(`order ${id}`), `order ${id}`);
});

// The placeholder round-trip exists so a URL path segment is not eaten by the
// hex/base64 rules. If it regresses, every logged URL turns into `***`.
test("redactString: URLs survive intact", () => {
  const url = "visit https://api.example.com/v1/things?limit=20";
  assert.equal(redactString(url), url);

  const longPath = "https://cdn.example.com/0123456789abcdef0123456789abcdef/file.zip";
  assert.equal(redactString(longPath), longPath);
});

test("redactString: multiple URLs are each restored to the right slot", () => {
  const input = "from https://a.example.com/one to https://b.example.com/two";
  assert.equal(redactString(input), input);
});

test("redactString: masks credentials in URL userinfo", () => {
  assert.equal(
    redactString("request https://user:secret@ghe.example.com/api/v3/repos failed"),
    "request https://***:***@ghe.example.com/api/v3/repos failed",
  );
});

test("redactString: masks sensitive URL query parameters and preserves benign ones", () => {
  const input = "https://api.example.com/items?Access_Token=secret&page=2&client_secret=also-secret";
  assert.equal(
    redactString(input),
    "https://api.example.com/items?Access_Token=***&page=2&client_secret=***",
  );
});

test("redactString: masks OAuth-style credentials in URL fragments", () => {
  assert.equal(
    redactString("https://example.com/callback#access_token=secret&state=public"),
    "https://example.com/callback#access_token=***&state=public",
  );
});

test("redactString: benign URLs remain byte-identical", () => {
  const input = "https://example.com:443/a%2Fb?per_page=20&page=2#section";
  assert.equal(redactString(input), input);
});

test("redactString: malformed URL escapes do not throw or bypass a sensitive raw key", () => {
  const input = "https://example.com/items?access_token=%ZZ&page=1";
  assert.doesNotThrow(() => redactString(input));
  assert.equal(redactString(input), "https://example.com/items?access_token=***&page=1");
});

test("redactString: caller text resembling a placeholder is not rewritten", () => {
  // The legacy `__URL_PLACEHOLDER_n__` form. Kept so the old shape stays inert,
  // but it does NOT exercise the collision guard — see the test below.
  assert.equal(redactString("__URL_PLACEHOLDER_0__"), "__URL_PLACEHOLDER_0__");
});

test("redactString: caller text matching the REAL internal sentinel is preserved", () => {
  // The implementation placeholders URLs with private-use-area sentinels
  // (RAYCAST_LOGGER_URL_<n>), not the legacy underscore form above.
  // Asserting the legacy string would pass even if the real collision guard
  // regressed, so this pins the sentinel actually in use.
  const sentinel = "RAYCAST_LOGGER_URL_0";
  assert.equal(redactString(sentinel), sentinel);

  // With a real URL alongside it, the caller's literal sentinel must survive
  // byte-for-byte while the genuine URL is still processed.
  const mixed = `${sentinel} and https://example.com/a?access_token=SECRET`;
  const output = redactString(mixed);
  assert.ok(output.startsWith(sentinel), "caller sentinel must be preserved verbatim");
  assert.doesNotMatch(output, /SECRET/);
  assert.match(output, /access_token=\*\*\*/);
});

test("redactString: ordinary prose is returned unchanged", () => {
  const plain = "Couldn't reach the server (503). Try again in a moment.";
  assert.equal(redactString(plain), plain);
});

test("redactString: empty string is handled", () => {
  assert.equal(redactString(""), "");
});

// ---------------------------------------------------------------------------
// redactByKey — full masking for credential keys.
// ---------------------------------------------------------------------------

test("redactByKey: credential keys are fully masked", () => {
  const keys = [
    "password",
    "pass",
    "pwd",
    "secret",
    "token",
    "auth",
    "authorization",
    "applepassword",
    "apple_password",
    "apple-password",
    "key",
    "apikey",
    "api_key",
    "accesstoken",
    "access_token",
    "apitoken",
    "bearer",
    "client_secret",
    "refreshToken",
    "private-key",
  ];
  for (const key of keys) {
    assert.equal(redactByKey(key, "supersecretvalue"), "***", `key "${key}" was not masked`);
  }
});

test("redactByKey: credential key matching is case-insensitive", () => {
  assert.equal(redactByKey("PASSWORD", "hunter2"), "***");
  assert.equal(redactByKey("Authorization", "Bearer xyz"), "***");
  assert.equal(redactByKey("ApiKey", "sk_live_1"), "***");
});

test("redactByKey: a key that merely contains a credential word is not blanket-masked", () => {
  // Membership is exact, not substring — `keyboardShortcut` must stay readable.
  assert.equal(redactByKey("keyboardShortcut", "cmd+k"), "cmd+k");
  assert.equal(redactByKey("passenger", "seat 4B"), "seat 4B");
  assert.equal(redactByKey("tokenizer", "bpe"), "bpe");
});

// ---------------------------------------------------------------------------
// redactByKey / `code` — THE REGRESSION TEST.
//
// A real download failure was logged as `{ name: 'DownloadError', code: '******' }`.
// The key `code` was blanket-masked, so the single most diagnostic field of the
// error object was destroyed — and worse, it looked like something had been
// captured when nothing had. A symbolic error code is never a secret.
// ---------------------------------------------------------------------------

test("redactByKey: REGRESSION — symbolic error codes must stay readable", () => {
  const symbolic = [
    "validation",
    "ENOENT",
    "ECONNREFUSED",
    "rate_limited",
    "http_server",
    "not_found",
    "url_expired",
  ];
  for (const value of symbolic) {
    assert.equal(
      redactByKey("code", value),
      value,
      `error.code "${value}" was masked — this is the DownloadError bug reintroduced`,
    );
  }
});

test("redactByKey: REGRESSION — a masked code is never mistaken for a captured one", () => {
  // The failure mode was not "the field is missing" but "the field lies".
  assert.notEqual(redactByKey("code", "ENOENT"), "******");
  assert.doesNotMatch(String(redactByKey("code", "ECONNREFUSED")), /\*/);
});

test("redactByKey: values that really look like a 2FA code are masked", () => {
  assert.equal(redactByKey("code", "123456"), "******");
  assert.equal(redactByKey("code", "1234"), "******");
  assert.equal(redactByKey("code", "12345678"), "******");
});

test("redactByKey: a whitespace-padded 2FA code is still masked", () => {
  assert.equal(redactByKey("code", " 4321 "), "******");
  assert.equal(redactByKey("otp", "\t123456\n"), "******");
});

test("redactByKey: digit strings outside the 4–8 window are not 2FA codes", () => {
  assert.equal(redactByKey("code", "123"), "123", "3 digits is too short to be a 2FA code");
  assert.equal(redactByKey("code", "123456789"), "123456789", "9 digits is too long to be a 2FA code");
});

test("redactByKey: an alphanumeric code value is not a 2FA code", () => {
  assert.equal(redactByKey("code", "12a45"), "12a45");
});

test("redactByKey: every 2FA-ish key follows the same look-like-a-code rule", () => {
  for (const key of ["code", "otp", "2fa", "twofactor", "two_factor"]) {
    assert.equal(redactByKey(key, "123456"), "******", `key "${key}" did not mask a real code`);
    assert.equal(redactByKey(key, "ENOENT"), "ENOENT", `key "${key}" masked a symbolic code`);
  }
});

test("redactByKey: 2FA key matching is case-insensitive", () => {
  assert.equal(redactByKey("CODE", "123456"), "******");
  assert.equal(redactByKey("Code", "123456"), "******");
  assert.equal(redactByKey("code", "123456"), "******");
  assert.equal(redactByKey("Code", "ENOENT"), "ENOENT");
});

// The fall-through matters: a symbolic `code` stays readable, but a `code` that
// happens to carry an embedded credential still gets scrubbed.
test("redactByKey: a non-2FA code value still runs through redactString", () => {
  assert.equal(redactByKey("code", "failed for user@example.com"), "failed for u***@example.com");
  assert.doesNotMatch(String(redactByKey("code", "token=abcdef")), /abcdef/);
});

// ---------------------------------------------------------------------------
// redactByKey — identifiers, numbers, nullish.
// ---------------------------------------------------------------------------

test("redactByKey: identifier keys are partially masked via maskEmail", () => {
  assert.equal(redactByKey("email", "user@example.com"), "u***@example.com");
  assert.equal(redactByKey("appleid", "chris@icloud.com"), "c***@icloud.com");
  assert.equal(redactByKey("apple_id", "chris@icloud.com"), "c***@icloud.com");
  assert.equal(redactByKey("username", "chris@me.com"), "c***@me.com");
  assert.equal(redactByKey("user", "chris@me.com"), "c***@me.com");
});

test("redactByKey: identifier masking keeps the domain visible for support triage", () => {
  const out = redactByKey("email", "chris.messina@gmail.com");
  assert.match(String(out), /@gmail\.com$/);
  assert.doesNotMatch(String(out), /messina/);
});

test("redactByKey: a non-email identifier value passes through maskEmail unchanged", () => {
  assert.equal(redactByKey("user", "plainname"), "plainname");
});

test("redactByKey: numeric 2FA values collapse to 0", () => {
  assert.equal(redactByKey("code", 404), 0);
  assert.equal(redactByKey("otp", 111111), 0);
  assert.equal(redactByKey("2fa", 1234), 0);
  assert.equal(redactByKey("twofactor", 123456), 0);
  assert.equal(redactByKey("two_factor", 123456), 0);
});

test("redactByKey: credential keys mask non-string values too", () => {
  assert.equal(redactByKey("password", 123456), "***");
  assert.equal(redactByKey("apple_password", true), "***");
  assert.equal(redactByKey("token", { nested: "secret" }), "***");
});

test("redactByKey: other numbers pass through untouched", () => {
  assert.equal(redactByKey("status", 500), 500);
  assert.equal(redactByKey("count", 0), 0);
  assert.equal(redactByKey("bytes", -1), -1);
});

test("redactByKey: null and undefined pass through untouched", () => {
  assert.equal(redactByKey("password", null), null);
  assert.equal(redactByKey("password", undefined), undefined);
  assert.equal(redactByKey("code", null), null);
  assert.equal(redactByKey("anything", undefined), undefined);
});

test("redactByKey: booleans pass through untouched", () => {
  assert.equal(redactByKey("enabled", true), true);
  assert.equal(redactByKey("enabled", false), false);
});

test("redactByKey: objects and arrays are returned as-is for JSON.stringify to recurse", () => {
  const nested = { a: 1 };
  assert.equal(redactByKey("payload", nested), nested);
  const arr = [1, 2];
  assert.equal(redactByKey("items", arr), arr);
});

test("redactByKey: an unremarkable key still gets string-level redaction", () => {
  assert.equal(redactByKey("message", "hello"), "hello");
  assert.equal(redactByKey("message", "mailto user@example.com"), "mailto u***@example.com");
});

// ---------------------------------------------------------------------------
// redactValueByKey
// ---------------------------------------------------------------------------

test("redactValueByKey: recurses through objects", () => {
  const out = redactValueByKey("payload", { password: "hunter2", code: "ENOENT", note: "hi" });
  assert.deepEqual(out, { password: "***", code: "ENOENT", note: "hi" });
});

test("redactValueByKey: primitives route through redactByKey", () => {
  assert.equal(redactValueByKey("password", "hunter2"), "***");
  assert.equal(redactValueByKey("code", "ENOENT"), "ENOENT");
});

test("redactValueByKey: nullish passes through", () => {
  assert.equal(redactValueByKey("password", null), null);
  assert.equal(redactValueByKey("password", undefined), undefined);
});

test("redactValueByKey: a circular object fails closed rather than returning the original", () => {
  const circular = { self: null, password: "hunter2" };
  circular.self = circular;
  const out = redactValueByKey("payload", circular);
  // Serialize the clone: String(out) yields "[object Object]" and would pass
  // even if the credential were sitting in plain sight on the result.
  const serialized = JSON.stringify(out);
  assert.notEqual(out, circular);
  assert.doesNotMatch(serialized, /hunter2/);
  assert.match(serialized, /"password":"\*\*\*"/);
  assert.match(serialized, /Circular/);
});

// ---------------------------------------------------------------------------
// sanitizeArgs — the object-level entry point.
// ---------------------------------------------------------------------------

test("sanitizeArgs: strings are redacted", () => {
  assert.deepEqual(sanitizeArgs(["contact user@example.com"]), ["contact u***@example.com"]);
});

test("sanitizeArgs: nested objects are traversed", () => {
  const out = sanitizeArgs([{ req: { headers: { authorization: "Bearer sk-live-REALKEY" } } }]);
  assert.deepEqual(out, [{ req: { headers: { authorization: "***" } } }]);
});

test("sanitizeArgs: arrays inside objects are traversed", () => {
  const out = sanitizeArgs([{ list: [{ token: "abc" }, "user@example.com"] }]);
  assert.deepEqual(out, [{ list: [{ token: "***" }, "u***@example.com"] }]);
});

test("sanitizeArgs: a top-level array argument is traversed", () => {
  assert.deepEqual(sanitizeArgs([[{ password: "p" }]]), [[{ password: "***" }]]);
});

test("sanitizeArgs: mixed types keep their identity", () => {
  const out = sanitizeArgs(["plain", 42, true, null, undefined]);
  assert.equal(out[0], "plain");
  assert.equal(out[1], 42);
  assert.equal(out[2], true);
  assert.equal(out[3], null);
  assert.equal(out[4], undefined);
});

test("sanitizeArgs: preserves argument count and order", () => {
  const out = sanitizeArgs(["a", { password: "p" }, 3]);
  assert.equal(out.length, 3);
  assert.equal(out[0], "a");
  assert.deepEqual(out[1], { password: "***" });
  assert.equal(out[2], 3);
});

test("sanitizeArgs: an empty argument list yields an empty list", () => {
  assert.deepEqual(sanitizeArgs([]), []);
});

// Logging must never alter the caller's data. If sanitizeArgs mutated in place,
// redaction would corrupt the very object the extension is about to act on.
test("sanitizeArgs: does not mutate its input", () => {
  const input = { password: "hunter2", nested: { token: "abc", code: "ENOENT" } };
  const snapshot = JSON.parse(JSON.stringify(input));
  const out = sanitizeArgs([input]);

  assert.deepEqual(input, snapshot, "sanitizeArgs mutated the caller's object");
  assert.notEqual(out[0], input, "sanitizeArgs returned the same reference");
  assert.equal(out[0].password, "***");
});

// The whole point of the DownloadError fix, exercised through the real entry point.
test("sanitizeArgs: REGRESSION — a logged error object keeps its diagnostic code", () => {
  const out = sanitizeArgs([{ name: "DownloadError", code: "url_expired", status: 403 }]);
  assert.deepEqual(out, [{ name: "DownloadError", code: "url_expired", status: 403 }]);
});

test("sanitizeArgs: a real credential inside an error object is still masked", () => {
  const out = sanitizeArgs([
    { name: "AuthError", code: "not_authorized", token: "sk-live-REALKEYMATERIAL" },
  ]);
  assert.equal(out[0].code, "not_authorized");
  assert.equal(out[0].token, "***");
});

test("sanitizeArgs: Error diagnostics survive while embedded secrets are redacted", () => {
  const [out] = sanitizeArgs([new Error("request failed with token=secret")]);
  assert.equal(out.name, "Error");
  assert.equal(out.message, "request failed with token=***");
  assert.doesNotMatch(out.stack, /token=secret/);
});

test("sanitizeArgs: nested URL credentials are redacted", () => {
  const [out] = sanitizeArgs([{ request: { url: "https://api.example.com?api_key=secret&page=1" } }]);
  assert.equal(out.request.url, "https://api.example.com?api_key=***&page=1");
});

test("sanitizeArgs: an unserializable object FAILS CLOSED rather than leaking", () => {
  // Updated 2026-08-01. This previously asserted `out[0] === circular` — i.e.
  // that an unserializable object degrades to the ORIGINAL. That is the leak:
  // the original is unredacted, so a payload which merely failed to serialize
  // logged its secrets in clear text.
  //
  // Verified before the fix: sanitizeArgs([{password:"hunter2", n:1n}])
  // emitted {"password":"hunter2", …}.
  const circular = { name: "x", password: "hunter2" };
  circular.self = circular;

  let out;
  assert.doesNotThrow(() => {
    out = sanitizeArgs([circular]);
  });

  assert.notEqual(out[0], circular, "must not hand back the unredacted object");
  assert.doesNotMatch(JSON.stringify(out[0]), /hunter2/, "the secret must never survive");
});

test("sanitizeArgs: REGRESSION — a BigInt payload does not leak its neighbours", () => {
  // JSON.stringify throws on BigInt, which used to route straight to the
  // fail-open branch and print every sibling field verbatim.
  const out = sanitizeArgs([{ password: "hunter2", token: "abc123", n: 1n }]);
  const serialized = JSON.stringify(out);
  assert.doesNotMatch(serialized, /hunter2/);
  assert.doesNotMatch(serialized, /abc123/);
});

// ---------------------------------------------------------------------------
// 2FA codes in natural prose. Added 2026-08-01 — the original regex required
// the digits to sit immediately after the label, so the single most common
// real-world shape (an SMS body) passed through untouched.
// ---------------------------------------------------------------------------

test("redactString: REGRESSION — a 2FA code in prose is masked, not just `code: NNNNNN`", () => {
  // Verified leaking before the fix: an SMS reads "Your verification code is
  // 123456", never "code: 123456".
  for (const input of [
    "Your code is 123456",
    "Your verification code is 123456",
    "your one-time code is 4321",
  ]) {
    assert.doesNotMatch(redactString(input), /\d{4,8}/, `leaked a 2FA code: ${input}`);
  }
});

test("redactString: the label must be a whole word — decode/barcode are not 2FA labels", () => {
  // A right-only word boundary matched the "code" inside "decode" and masked an
  // unrelated number.
  for (const input of ["decode 12345678 bytes", "barcode 12345678", "encoded 12345678 chars"]) {
    assert.equal(redactString(input), input, `false positive on: ${input}`);
  }
});

test("redactString: a 9+ digit run is not partially masked", () => {
  // `\d{4,8}` alone matched the first 8 digits of `1234567890` and left "90"
  // visible — a partial mask that reads as a complete one.
  const out = redactString("code: 1234567890");
  assert.doesNotMatch(out, /\*{6}\d/, `partial mask left digits visible: ${out}`);
  // Absence of a partial mask is not enough: masking the whole run would also
  // satisfy it while destroying the diagnostic. Pin that the run survives.
  assert.match(out, /1234567890/, `9+ digit run must be preserved: ${out}`);
});

test("redactString: ordinary prose containing the word 'code' is untouched", () => {
  assert.equal(redactString("the code is fine"), "the code is fine");
  assert.equal(redactString("error code ENOENT"), "error code ENOENT");
});

// ---------------------------------------------------------------------------
// Regressions from the 2026-08-04 adversarial review of 8cef6e3.
//
// Every case below was a CONFIRMED secret leak reproduced against that commit.
// Each asserts the leak is closed AND, where the fix risked over-masking, that
// a sibling non-secret is still readable.
// ---------------------------------------------------------------------------

test("regression: a nested URL cannot hide its query secret inside an outer parameter", () => {
  // The outer matcher consumed `?access_token=...` as part of `redirect`'s
  // value, so the key it tested was `redirect` — not a credential.
  const input = "https://example.test/?redirect=https://idp.test/cb?access_token=LEAK123&mode=x";
  const output = redactString(input);
  assert.doesNotMatch(output, /LEAK123/, `nested URL secret survived: ${output}`);
  assert.match(output, /mode=x/, "benign sibling parameter must survive");
});

test("regression: semicolon-separated URL parameters are redacted", () => {
  const output = redactString("https://a.test/?page=1;access_token=LEAK123");
  assert.doesNotMatch(output, /LEAK123/);
  assert.match(output, /page=1/);
});

test("regression: toJSON cannot move a credential onto an innocent key", () => {
  // JSON.stringify calls toJSON BEFORE the replacer, so key-based redaction
  // never saw `password` — it only saw `note`.
  const value = {
    password: "LEAK123",
    toJSON() {
      return { note: this.password };
    },
  };
  assert.doesNotMatch(JSON.stringify(sanitizeArgs([value])), /LEAK123/);
});

test("regression: a second toJSON call cannot smuggle a different snapshot", () => {
  // The old BigInt retry re-serialized the value, invoking toJSON again; the
  // second call could return something the first never exposed.
  let calls = 0;
  const value = {
    toJSON() {
      return ++calls === 1 ? { n: 1n } : { note: "LEAK123" };
    },
  };
  assert.doesNotMatch(JSON.stringify(sanitizeArgs([value])), /LEAK123/);
});

test("regression: an Error subclass with toJSON cannot bypass Error flattening", () => {
  class LeakyError extends Error {
    constructor() {
      super("safe message");
      this.name = "LeakyError";
      this.password = "ERROR_SECRET";
    }
    toJSON() {
      return { note: this.password };
    }
  }
  const output = JSON.stringify(sanitizeArgs([new LeakyError()]));
  assert.doesNotMatch(output, /ERROR_SECRET/);
  // Flattening must still produce a useful error.
  assert.match(output, /safe message/);
  assert.match(output, /LeakyError/);
});

test("regression: environment-style compound credential keys are masked", () => {
  for (const key of ["NPM_TOKEN", "GITHUB_TOKEN", "DB_PASSWORD", "STRIPE_SECRET", "MY_API_KEY"]) {
    const output = JSON.stringify(sanitizeArgs([{ [key]: "LEAK123" }]));
    assert.doesNotMatch(output, /LEAK123/, `${key} was not masked`);
  }
  assert.doesNotMatch(redactString("NPM_TOKEN=LEAK123"), /LEAK123/);
  assert.doesNotMatch(redactString("GITHUB_ACCESS_TOKEN: LEAK123"), /LEAK123/);
});

test("regression: compound keys whose head noun is not a secret stay readable", () => {
  // The counterweight to the rule above. Masking these would destroy exactly
  // the diagnostics this package exists to preserve. `key` on its own is an
  // overloaded English word — a cache key and a sort key are not credentials.
  for (const key of ["cacheKey", "sortKey", "partitionKey", "publicKey", "idempotencyKey", "apiKeyValue"]) {
    const output = JSON.stringify(sanitizeArgs([{ [key]: "PLAINVALUE" }]));
    assert.match(output, /PLAINVALUE/, `${key} must not be masked`);
  }
});

test("regression: 'apikey' as a two-word head noun is masked in either spelling", () => {
  // v1.2.4 masked only the exact key `apiKey`. `myApiKey` and `MY_API_KEY` are
  // the same credential wearing a prefix, and both now mask. This narrows the
  // previously documented "exact match only" behavior on purpose.
  for (const key of ["myApiKey", "MY_API_KEY", "stripeApiKey", "openai_api_key"]) {
    const output = JSON.stringify(sanitizeArgs([{ [key]: "LEAK123" }]));
    assert.doesNotMatch(output, /LEAK123/, `${key} was not masked`);
  }
});

test("regression: underscore-form two_factor labels are masked in messages", () => {
  assert.doesNotMatch(redactString("two_factor: 123456"), /123456/);
  // The already-supported spellings must keep working.
  assert.doesNotMatch(redactString("two-factor: 123456"), /123456/);
  assert.doesNotMatch(redactString("two factor: 123456"), /123456/);
});

test("regression: getters are still invoked but a throwing one fails closed", () => {
  const hostile = {
    get boom() {
      throw new Error("token=SECRET");
    },
  };
  const result = sanitizeArgs([hostile])[0];
  assert.equal(typeof result, "string");
  assert.match(result, /withheld/);
  assert.doesNotMatch(result, /SECRET/);
});

test("regression: Date and RegExp keep meaning now that toJSON is not called", () => {
  // Date.toJSON is no longer invoked, so the walker must handle it explicitly
  // or dates would collapse to `{}`.
  const output = JSON.stringify(sanitizeArgs([{ when: new Date("2020-01-02T03:04:05.000Z"), re: /ab+c/gi }]));
  assert.match(output, /2020-01-02T03:04:05/);
  assert.match(output, /ab\+c/);
});

test("regression: a credential-named key holding an object is masked before traversal", () => {
  const output = JSON.stringify(sanitizeArgs([{ a: { b: { token: { deep: "LEAK123" } } } }]));
  assert.doesNotMatch(output, /LEAK123/);
  assert.doesNotMatch(output, /deep/);
});

test("regression: a long delimiter chain cannot stall the credential matcher", () => {
  // The env-prefix group is bounded to {0,6}. Unbounded, this input backtracked
  // for ~2.5 seconds because every start position could consume an arbitrary
  // run of `a-` before failing to find a credential word.
  const hostile = "a-".repeat(30000) + "secret=x";
  const started = process.hrtime.bigint();
  const output = redactString(hostile);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(elapsedMs < 1000, `credential matcher took ${elapsedMs.toFixed(0)}ms`);
  assert.doesNotMatch(output, /secret=x/, "the credential must still be masked");
});

test("regression: realistic environment variable names still match within the bound", () => {
  assert.equal(redactString("NPM_TOKEN=abc"), "NPM_TOKEN=***");
  assert.equal(redactString("GITHUB_ACCESS_TOKEN: abc"), "GITHUB_ACCESS_TOKEN: ***");
  assert.equal(redactString("tokenizer=keepme"), "tokenizer=keepme");
});

test("regression: shared g-flagged credential patterns stay deterministic across calls", () => {
  // QUOTED_/BARE_CREDENTIAL_ASSIGNMENT are module-level RegExp objects reused
  // on every call. They are safe only because String.replace resets lastIndex.
  // If someone switches them to .test()/.exec(), redaction silently becomes
  // order-dependent — this pins that it does not.
  const inputs = ["token=AAA", "password=BBB and token=CCC", "no secrets here", "NPM_TOKEN=DDD"];
  const expected = inputs.map((input) => redactString(input));

  for (let round = 0; round < 100; round++) {
    inputs.forEach((input, index) => {
      assert.equal(redactString(input), expected[index], `drifted on round ${round}: ${input}`);
    });
  }
  // And the expected values must actually be masked, so this cannot pass by
  // comparing four identical unredacted strings.
  assert.doesNotMatch(expected.join(" "), /AAA|BBB|CCC|DDD/);
});

// ---------------------------------------------------------------------------
// Second review round (2026-08-04). Findings the first round of fixes missed.
// ---------------------------------------------------------------------------

test("regression: credential keys mask EVERY runtime type, not just strings", () => {
  // The credential guard originally ran after the primitive type dispatch, so
  // bigint/symbol/function values converted themselves to text and returned
  // before it was reached — contradicting the documented contract.
  function LEAKFN() {}
  // Every type the walker dispatches on, so a bypass reintroduced for any
  // single branch (arrays were missing before) fails this test.
  const cases = [
    { token: 12345678901234567890n },
    { token: Symbol("LEAKSYM") },
    { token: LEAKFN },
    { token: ["ARRAYSECRET"] },
    { token: { nested: "OBJECTSECRET" } },
    { token: true },
    { token: 4242424242 },
    { NPM_TOKEN: 98765432109876543210n },
  ];
  for (const value of cases) {
    const output = JSON.stringify(sanitizeArgs([value]));
    assert.doesNotMatch(
      output,
      /12345678901234567890|LEAKSYM|LEAKFN|ARRAYSECRET|OBJECTSECRET|98765432109876543210|4242424242/,
      output,
    );
    assert.match(output, /\*\*\*/, `mask marker missing: ${output}`);
  }
});

test("regression: hostile built-in overrides cannot emit raw strings", () => {
  // Date/RegExp/URL are read through intrinsic prototype methods, so an
  // override cannot hand the walker an arbitrary attacker-chosen string.
  class HostileDate extends Date {
    toISOString() {
      return "LEAKDATE";
    }
  }
  const hostileRegExp = /x/;
  hostileRegExp.toString = () => "LEAKREGEXP";
  const hostileUrl = new URL("https://example.test/");
  Object.defineProperty(hostileUrl, "href", { get: () => "LEAKURL" });

  const output = JSON.stringify(sanitizeArgs([{ d: new HostileDate(), r: hostileRegExp, u: hostileUrl }]));
  assert.doesNotMatch(output, /LEAKDATE|LEAKREGEXP|LEAKURL/, output);
  // Absence alone would be satisfied by withholding all three. Assert the
  // intrinsic values still come through, so the diagnostic is not lost.
  assert.match(output, /\d{4}-\d{2}-\d{2}T/, `Date lost its value: ${output}`);
  assert.match(output, /\/x\//, `RegExp lost its value: ${output}`);
  assert.match(output, /example\.test/, `URL lost its value: ${output}`);
});

test("regression: toJSON is never INVOKED, not merely ignored", () => {
  // The earlier tests only asserted the output lacked a secret. A regression
  // that called toJSON once and emitted a benign first snapshot would pass
  // while violating the stated invariant — so count the calls.
  let calls = 0;
  const value = {
    safe: "visible",
    toJSON() {
      calls += 1;
      return { note: "from-toJSON" };
    },
  };
  const output = JSON.stringify(sanitizeArgs([value]));
  assert.equal(calls, 0, "toJSON must never be invoked");
  assert.match(output, /visible/);
  assert.doesNotMatch(output, /from-toJSON/);
});

test("regression: percent-encoded nested URLs cannot hide a credential", () => {
  const encode = (text, layers) => {
    let out = text;
    for (let i = 0; i < layers; i++) out = encodeURIComponent(out);
    return out;
  };
  // Multiple layers: a fixed 3-round decode bound previously let 4 layers through.
  for (const layers of [1, 2, 3, 4, 5, 6]) {
    const input = `https://example.test/?redirect=${encode(`https://idp.test/cb?access_token=LEAKENC${layers}`, layers)}&page=2`;
    const output = redactString(input);
    assert.doesNotMatch(output, new RegExp(`LEAKENC${layers}`), `${layers} layers: ${output}`);
    assert.match(output, /redirect=\*\*\*/, `mask marker missing at ${layers} layers: ${output}`);
    assert.match(output, /page=2/, `benign sibling lost at ${layers} layers: ${output}`);
  }
  // A malformed escape must not disable inspection of the rest.
  const malformed = redactString(
    "https://a.test/?redirect=https%3A%2F%2Fidp.test%2Fcb%3Faccess_token%3DDECODEERR%ZZ",
  );
  assert.doesNotMatch(malformed, /DECODEERR/, malformed);
});

test("regression: ubiquitous env credential names are masked", () => {
  // Acronym-prefixed spellings too: `DBPassword` and `NPMToken` were single
  // segments before camelCase splitting handled an uppercase run.
  for (const key of ["DB_PASS", "DB_AUTH", "authorizationHeader", "AUTH_TOKEN", "DBPassword", "NPMToken", "HTTPAuthorizationHeader", "tokenValue"]) {
    const output = JSON.stringify(sanitizeArgs([{ [key]: "LEAK123" }]));
    assert.doesNotMatch(output, /LEAK123/, `${key} was not masked`);
    assert.match(output, /\*\*\*/, `${key} produced no mask marker`);
  }
});

test("regression: long env-style labels are masked in messages", () => {
  // There is no prefix-count bound any more: the label matcher accepts any
  // identifier and isCredentialKey decides. A fixed bound was a hard
  // false-negative boundary — 7 leaked at {0,6}, 13 leaked at {0,12}.
  assert.doesNotMatch(redactString("FOO_BAR_BAZ_QUX_QUUX_CORGE_GRAULT_TOKEN=LEAKLABEL"), /LEAKLABEL/);
  assert.doesNotMatch(redactString("A_B_C_D_E_F_G_H_I_J_K_L_M_TOKEN=THIRTEEN"), /THIRTEEN/);

  // The one remaining limit is a 128-CHARACTER cap on the identifier itself,
  // which exists to keep the matcher linear (see CREDENTIAL_LABEL). Assert the
  // real boundary rather than pretending it does not exist: a long-but-
  // realistic name masks, and the documented cap is where it stops.
  const realistic = "GITHUB_ENTERPRISE_SERVER_OAUTH_APP_CLIENT_ACCESS_TOKEN";
  assert.ok(realistic.length < 128);
  assert.doesNotMatch(redactString(`${realistic}=REALISTIC`), /REALISTIC/);
  // The message and structured paths must agree on what is NOT a credential.
  assert.match(redactString("cache_key=PLAINVALUE"), /cache_key=PLAINVALUE/);
  assert.match(JSON.stringify(sanitizeArgs([{ cache_key: "PLAINVALUE" }])), /PLAINVALUE/);
});

test("regression: a __proto__ key cannot reparent the returned object", () => {
  // Plain assignment invoked the inherited __proto__ setter and reparented the
  // result instead of creating an own property.
  const payload = JSON.parse(String.raw`{"__proto__":{"inherited":"LEAKPROTO"},"ok":1}`);
  const result = sanitizeArgs([payload])[0];
  const prototype = Object.getPrototypeOf(result);
  assert.notEqual(prototype?.inherited, "LEAKPROTO");
  assert.equal({}.inherited, undefined, "global Object.prototype must be clean");
  // defineEntry must create a real OWN property, not silently drop the key —
  // skipping __proto__ entirely would also avoid reparenting but lose data.
  assert.ok(Object.prototype.hasOwnProperty.call(result, "__proto__"), "__proto__ must become an own property");
  assert.match(JSON.stringify(result), /"ok":1/);
});

test("regression: an Error with very many own properties is bounded", () => {
  const error = new Error("boom");
  for (let index = 0; index < 1000; index++) error[`prop${index}`] = index;
  const result = sanitizeArgs([error])[0];
  assert.ok(Object.keys(result).length <= 204, `unbounded error walk: ${Object.keys(result).length}`);
  assert.match(JSON.stringify(result), /boom/);
});

// ---------------------------------------------------------------------------
// Fourth review round (2026-08-04).
// ---------------------------------------------------------------------------

test("regression: a chain of innocuous assignments cannot exhaust the recursion budget", () => {
  // A depth bound of 4 let five innocuous labels consume the budget before the
  // credential was reached.
  assert.doesNotMatch(redactString("a=b=c=d=e=token=DEPTHSECRET"), /DEPTHSECRET/);
  assert.doesNotMatch(redactString("a=b=c=d=e=f=g=h=i=j=token=DEEPER"), /DEEPER/);
  // Binds the bound itself: at depth 20 the credential must still be found.
  const chain = Array.from({ length: 20 }, (_, i) => `k${i}=`).join("");
  assert.doesNotMatch(redactString(`${chain}token=DEEPEST`), /DEEPEST/);
  // And the innocuous labels must survive rather than being blanket-masked.
  assert.match(redactString("a=b=c=token=X"), /a=b=c=/);
});

test("regression: all-uppercase concatenated keys are recognized", () => {
  // `DBPASSWORD` has no delimiter and no case transition, so segmentation
  // produced one unmatchable token.
  for (const key of ["DBPASSWORD", "NPMTOKEN", "MYSECRET", "APITOKEN"]) {
    assert.doesNotMatch(JSON.stringify(sanitizeArgs([{ [key]: "UPPERLEAK" }])), /UPPERLEAK/, key);
    assert.doesNotMatch(redactString(`${key}=UPPERLEAK`), /UPPERLEAK/, `${key} in message`);
  }
  // The suffix fallback uses only unambiguous terms, so ordinary words that
  // merely end in `key`/`pass` are untouched.
  for (const key of ["monkey", "bypass", "compass", "harness", "witness"]) {
    assert.match(JSON.stringify(sanitizeArgs([{ [key]: "PLAINVALUE" }])), /PLAINVALUE/, key);
  }
});

test("regression: plus-separated parameter names are segmented", () => {
  // `%2B` decodes to `+`, which was not a segment separator, so `access+token`
  // stayed one unrecognized word.
  assert.doesNotMatch(redactString("https://a.test/?access%2Btoken=PLUSLEAK"), /PLUSLEAK/);
  assert.doesNotMatch(JSON.stringify(sanitizeArgs([{ "access+token": "PLUSLEAK" }])), /PLUSLEAK/);
});

test("regression: deep percent-encoding cannot outrun the decoder", () => {
  // Limits of 3 and then 8 were each defeated by adding one more layer.
  const encode = (text, layers) => {
    let out = text;
    for (let i = 0; i < layers; i++) out = encodeURIComponent(out);
    return out;
  };
  for (const layers of [9, 12, 20, 30]) {
    const input = `https://example.test/?redirect=${encode(`https://idp.test/cb?access_token=DEEP${layers}`, layers)}`;
    assert.doesNotMatch(redactString(input), new RegExp(`DEEP${layers}`), `${layers} layers`);
  }
});

test("regression: the message label matcher handles long keys and stays linear", () => {
  // The cap was 128, which made a 129-character key mask as an object key and
  // leak in a message. It is now 512 — see CREDENTIAL_LABEL for why a bound
  // still exists at all.
  for (const length of [130, 200, 400, 500]) {
    const key = `${"A".repeat(length - 6)}_TOKEN`;
    assert.doesNotMatch(redactString(`${key}=LONGLEAK`), /LONGLEAK/, `${length}-char key`);
  }
  // Both hostile shapes: the bare matcher succeeds early, the quoted matcher
  // fails at every position, which is the expensive case.
  for (const hostile of ["a-".repeat(30000) + "secret=x", "a-".repeat(30000) + 'secret="x"']) {
    const started = process.hrtime.bigint();
    redactString(hostile);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 1000, `label matcher took ${elapsedMs.toFixed(0)}ms`);
  }
});
