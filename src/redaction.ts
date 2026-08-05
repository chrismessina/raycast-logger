/**
 * Redaction utilities for sanitizing sensitive data in logs
 */

const CREDENTIAL_KEYS = new Set([
  "password",
  "pass",
  "pwd",
  "secret",
  "token",
  "auth",
  "authorization",
  "applepassword",
  "key",
  "apikey",
  "accesstoken",
  "apitoken",
  "bearer",
  "clientsecret",
  "refreshtoken",
  "idtoken",
  "oauthtoken",
  "privatekey",
  "signingkey",
]);

const TWO_FACTOR_KEYS = new Set(["code", "otp", "2fa", "twofactor", "verificationcode", "onetimecode"]);
const IDENTIFIER_KEYS = new Set(["email", "appleid", "username", "user"]);

/**
 * Terms that make a COMPOUND key sensitive when they appear as its final
 * segment, so environment-style names like `NPM_TOKEN`, `GITHUB_TOKEN`, and
 * `DB_PASSWORD` are masked rather than sailing through the exact-match set.
 *
 * `key` and `code` are deliberately excluded: they are heavily overloaded as
 * trailing words, and `cacheKey`, `sortKey`, `partitionKey`, `publicKey`,
 * `statusCode`, and `errorCode` are not secrets. Masking them would destroy
 * exactly the diagnostics this package exists to preserve — the same failure
 * mode as the old blanket `error.code` masking. Both still redact on an exact
 * whole-key match.
 */
const CREDENTIAL_SUFFIXES = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "accesstoken",
  "apitoken",
  "refreshtoken",
  "idtoken",
  "oauthtoken",
  "clientsecret",
  "privatekey",
  "signingkey",
  "credential",
  "credentials",
  // Head-position only. `DB_PASS` and `DB_AUTH` are ubiquitous environment
  // names, and leaking one is worse than losing the diagnostic value of a
  // field like `firstPass` or `boardingPass` that happens to end the same way.
  // Not in CREDENTIAL_ANYWHERE, so `passThrough` and `authFlow` are untouched.
  "pass",
  "pwd",
  "auth",
]);

/**
 * Terms sensitive in ANY segment, not just the head.
 *
 * `authorizationHeader` holds a credential even though its head noun is
 * `header`; so do `tokenValue` and `secretRef`. Restricted to unambiguous
 * terms — `key`, `pass`, `auth`, `code`, and `value` are excluded, so
 * `apiKeyValue` and `cacheKeyPrefix` keep their diagnostics.
 *
 * The cost is accepted deliberately: `cancellationToken` and
 * `refreshTokenExpiresAt` are masked despite not being secrets. Masking a
 * non-secret loses a diagnostic; missing a secret leaks it.
 */
const CREDENTIAL_ANYWHERE = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "accesstoken",
  "apitoken",
  "refreshtoken",
  "idtoken",
  "oauthtoken",
  "clientsecret",
  "privatekey",
  "signingkey",
  "credential",
  "credentials",
  "authorization",
]);

/**
 * Treat camelCase, snake_case, kebab-case, and space-separated key spellings
 * consistently without broad substring matching (for example, `tokenizer`
 * must not be treated as `token`).
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Split a key into its component words across snake_case, kebab-case, spaces,
 * and camelCase boundaries. `NPM_TOKEN` -> ["npm", "token"];
 * `myApiKeyValue` -> ["my", "api", "key", "value"].
 */
function keySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

function isCredentialKey(key: string): boolean {
  if (CREDENTIAL_KEYS.has(normalizeKey(key))) return true;

  // A compound key is sensitive when its HEAD noun is. English compounds put
  // the head last, so `NPM_TOKEN` is a token but `apiKeyValue` is a value.
  //
  // The head is checked as both the final segment and the final TWO segments
  // joined, because the terms themselves are compounds: `MY_API_KEY` splits to
  // ["my","api","key"], whose head is the two-word term "apikey". Checking only
  // the last segment would miss it, since bare "key" is excluded above.
  const segments = keySegments(key);
  if (segments.length < 2) return false;
  if (CREDENTIAL_SUFFIXES.has(segments[segments.length - 1])) return true;
  if (CREDENTIAL_SUFFIXES.has(segments.slice(-2).join(""))) return true;
  // An unambiguous credential word anywhere in the key, for names whose head
  // noun is a container rather than the secret itself (`authorizationHeader`).
  return segments.some((segment) => CREDENTIAL_ANYWHERE.has(segment));
}

/**
 * Credential label used by the message-level rules, written once so the quoted
 * and unquoted variants cannot drift apart.
 *
 * `(?:[A-Za-z0-9]+[_-]){0,12}` allows an environment-style prefix, so
 * `NPM_TOKEN=x` and `GITHUB_ACCESS_TOKEN: x` are recognized. `\b` alone could
 * not do this: `_` is a word character, so there is no boundary between `NPM_`
 * and `TOKEN`.
 *
 * The bound is load-bearing, not cosmetic. Unbounded (`*`), a long delimiter
 * chain that never reaches a credential word — `"a-".repeat(30000)` followed by
 * `secret=x` — backtracked for ~2.5 SECONDS, because every start position could
 * consume an arbitrary run before failing. A fixed bound makes the work per
 * start position constant; cost then grows linearly in the bound, measured at
 * ~2ms for 6 and ~3ms for 12 on that same hostile input. Twelve is far above
 * any realistic environment variable name while staying cheap.
 *
 * The trailing `\b` still protects `tokenizer`, which has no boundary between
 * `token` and `izer`.
 */
const CREDENTIAL_LABEL =
  "(?:[A-Za-z0-9]+[_-]){0,12}(?:password|pass|pwd|secret|token|auth|authorization|key|api[_-]?key|access[_-]?token|api[_-]?token|client[_-]?secret|refresh[_-]?token|id[_-]?token|oauth[_-]?token|private[_-]?key|signing[_-]?key|apple[_-]?password|credentials?)";

/*
 * Both patterns below are module-level `g`-flagged RegExp objects reused across
 * every call, which normally invites a `lastIndex` bug: a stateful regex that
 * resumes mid-string produces intermittent, input-order-dependent redaction.
 *
 * They are safe ONLY because both are used exclusively with `String.replace()`,
 * which sets `lastIndex` to 0 before matching and resets it afterward.
 *
 * If either is ever used with `.test()`, `.exec()`, or `.matchAll()`, that
 * guarantee disappears and redaction becomes nondeterministic. Reset
 * `lastIndex` explicitly or build a local copy at the call site.
 */

/** `key: "quoted value"` — masks inside the quotes, preserving the quoting. */
const QUOTED_CREDENTIAL_ASSIGNMENT = new RegExp(
  `(["']?)\\b(${CREDENTIAL_LABEL})\\b\\1(\\s*[:=]\\s*)(["'])(?:\\\\.|(?!\\4)[^\\\\\\r\\n])*\\4`,
  "gi",
);

/** `key=bare-value` — masks to the next delimiter. */
const BARE_CREDENTIAL_ASSIGNMENT = new RegExp(
  `(["']?)\\b(${CREDENTIAL_LABEL})\\b\\1(\\s*[:=]\\s*)[^\\s&,;"')\\]}]+`,
  "gi",
);

/**
 * Does this percent-encoded parameter value decode to something carrying a
 * credential-named parameter of its own?
 *
 * Decoding is applied repeatedly (bounded) because a value can be encoded more
 * than once; each round is checked before decoding again. The scan is plain
 * string splitting rather than a recursive `redactUrl` call, so there is no
 * mutual recursion and a decoded fragment without a scheme is still inspected.
 */
function decodedCarriesCredential(rawValue: string): boolean {
  let current = rawValue;
  for (let round = 0; round < 3; round++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current.replace(/\+/g, " "));
    } catch {
      return false;
    }
    if (decoded === current) return false;

    for (const pair of decoded.split(/[?&#;]/)) {
      const equals = pair.indexOf("=");
      if (equals <= 0) continue;
      if (isCredentialKey(pair.slice(0, equals))) return true;
    }
    current = decoded;
  }
  return false;
}

/**
 * Redact credentials inside a URL while preserving its original formatting.
 * Using string slices rather than serializing through `URL` avoids harmless
 * normalization changes to ports, escapes, query order, and punctuation.
 */
function redactUrl(input: string): string {
  const schemeEnd = input.indexOf("://") + 3;
  if (schemeEnd < 3) return input;

  let output = input;
  const authorityEndOffset = output.slice(schemeEnd).search(/[/?#]/);
  const authorityEnd = authorityEndOffset === -1 ? output.length : schemeEnd + authorityEndOffset;
  const authority = output.slice(schemeEnd, authorityEnd);
  const at = authority.lastIndexOf("@");

  if (at !== -1) {
    const userInfo = authority.slice(0, at);
    const host = authority.slice(at + 1);
    const maskedUserInfo = userInfo.includes(":") ? "***:***" : "***";
    output = `${output.slice(0, schemeEnd)}${maskedUserInfo}@${host}${output.slice(authorityEnd)}`;
  }

  // `?` and `;` are treated as parameter separators alongside `&` and `#`, and
  // are excluded from key and value runs. Without that, a nested URL swallowed
  // its own query string as part of the outer parameter's value:
  //
  //   ?redirect=https://idp.test/cb?access_token=LEAK
  //
  // matched as key `redirect` — not a credential — leaving the embedded
  // `access_token` fully visible. Semicolon-delimited parameters (`?a=1;token=x`)
  // hid the same way. Splitting on both makes each nested pair its own match.
  return output.replace(
    /([?&#;])([^=&#;?]+)=([^&#;?]*)/g,
    (match, separator: string, rawKey: string, rawValue: string) => {
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      } catch {
        // A malformed escape must never make logging throw. The undecoded key
        // still gets checked, and later string rules provide a second chance.
      }
      if (isCredentialKey(key)) return `${separator}${rawKey}=***`;

      // A percent-ENCODED nested URL hides its own query from the separator
      // split above, because `%3F` and `%26` are ordinary characters here:
      //
      //   ?redirect=https%3A%2F%2Fidp.test%2Fcb%3Faccess_token%3DLEAK
      //
      // Decode the value and inspect the parameters it carries. If any of them
      // is credential-named, mask the WHOLE value rather than re-encoding a
      // partial fix — re-encoding cannot faithfully reproduce the caller's
      // original escaping, and a half-rewritten URL is worse than a masked one.
      if (rawValue && rawValue.includes("%") && decodedCarriesCredential(rawValue)) {
        return `${separator}${rawKey}=***`;
      }
      return match;
    },
  );
}

function redactLikelyEncodedSecrets(input: string): string {
  // A pure digit run is usually an identifier, not hex. Requiring both a digit
  // and an A-F character keeps hashes covered without destroying long IDs.
  let output = input.replace(
    /(?<![A-Za-z0-9])[A-Fa-f0-9]{32,}(?![A-Za-z0-9])/g,
    (candidate) => (/\d/.test(candidate) && /[A-Fa-f]/.test(candidate) ? "***" : candidate),
  );

  // It is impossible to distinguish an unpadded, letters-only base64 value
  // from an ordinary word. Restrict the heuristic to valid four-character
  // blocks with at least one base64 signal (digit, +, /, or padding) and at
  // least one letter. Key- and label-based rules still mask ambiguous tokens.
  output = output.replace(
    /(?<![A-Za-z0-9+/=])(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![A-Za-z0-9+/=])/g,
    (candidate) =>
      /[A-Za-z]/.test(candidate) && /[0-9+/=]/.test(candidate) ? "***" : candidate,
  );

  return output;
}

/**
 * Mask email addresses, showing only first character and domain
 * @param text Text containing potential email addresses
 * @returns Text with masked emails
 * @example "user@example.com" → "u***@example.com"
 */
function maskEmail(text: string): string {
  // Use a proper email regex that won't greedily match URL schemes/paths
  // The (?<![A-Za-z0-9._%+-]) negative lookbehind ensures we start at the beginning of the email
  return text.replace(
    /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    (_m, p1: string, _p2: string, p3: string) => `${p1}***${p3}`,
  );
}

/**
 * Redact sensitive information from strings
 * @param input String that may contain sensitive data
 * @returns Sanitized string with sensitive data redacted
 */
export function redactString(input: string): string {
  // Preserve URLs by replacing them with placeholders after scrubbing URL
  // credentials. This keeps benign paths out of the encoded-secret heuristics.
  const urlPlaceholders: string[] = [];
  let placeholderPrefix = "\uE000RAYCAST_LOGGER_URL_";
  while (input.includes(placeholderPrefix)) placeholderPrefix += "_";
  let s = input.replace(
    /https?:\/\/[^\s"'<>\])}]+/gi,
    (match) => {
      urlPlaceholders.push(redactUrl(match));
      return `${placeholderPrefix}${urlPlaceholders.length - 1}\uE001`;
    },
  );

  // Apply redactions without touching the placeholders.
  s = s.replace(/\b(bearer)(\s+)[^\s"']+/gi, "$1$2***");

  // Preserve the original key spelling, delimiter, whitespace, and optional
  // quotes so JSON-ish and line-oriented logs remain structurally useful.
  s = s.replace(QUOTED_CREDENTIAL_ASSIGNMENT, "$1$2$1$3$4***$4");
  s = s.replace(BARE_CREDENTIAL_ASSIGNMENT, "$1$2$1$3***");
  // Mask a labeled 2FA/OTP code.
  //
  // The label and the digits are allowed to be separated by a few filler words,
  // because the natural-prose form is exactly how these arrive: an SMS reads
  // "Your verification code is 123456", not "code: 123456". Requiring the digits
  // to sit immediately after the label let the most common real-world shape
  // through untouched.
  //
  // `\d{4,8}(?!\d)` rather than `\d{4,8}`: without the guard, a longer run like
  // `1234567890` matched only its first 8 digits and left "90" visible — a
  // partial mask that reads as a full one. Now a 9+ digit run is not treated as
  // a 2FA code at all (the credential rules below still cover it).
  // `\b` on BOTH sides of the label: without a left boundary, "decode",
  // "barcode" and "encoded" all matched their trailing "code" and masked an
  // unrelated number — e.g. "decode 12345678 bytes" became "decode ****** bytes".
  s = s.replace(
    /(\b(?:code|2fa|two[-_\s]?factor|otp)\b(?:\s+\w+){0,3}\s*[:=\s]\s*)(\d{4,8})(?!\d)/gi,
    (_m, p1: string) => `${p1}******`,
  );
  // Mask likely encoded secrets while preserving ordinary words and IDs.
  s = redactLikelyEncodedSecrets(s);
  // Mask emails
  s = maskEmail(s);

  // Restore only placeholders created in this invocation. A caller-provided
  // string that resembles an old placeholder must remain byte-identical.
  urlPlaceholders.forEach((url, index) => {
    s = s.split(`${placeholderPrefix}${index}\uE001`).join(url);
  });

  return s;
}

/**
 * Redact a value based on its key name - safe to use as JSON.stringify replacer
 * Does NOT recurse into objects; lets JSON.stringify handle traversal
 */
export function redactByKey(key: string, value: unknown): unknown {
  const k = normalizeKey(key);
  if (value == null) return value;

  // Credential keys are sensitive regardless of whether their runtime value
  // happens to be a string, number, bigint, boolean, or nested object.
  // Uses isCredentialKey (not the bare exact-match set) so compound
  // environment-style names like `NPM_TOKEN` are covered for primitives too.
  if (isCredentialKey(key)) return "***";

  if (typeof value === "string") {
    // Redact 2FA codes — but only values that actually LOOK like one.
    //
    // `code` is heavily overloaded. `error.code` is `ENOENT`, `ECONNREFUSED`,
    // `validation`, `rate_limited` — never a secret. Blanket-masking the key
    // turned the single most diagnostic field of an error object into
    // `******`, producing log lines like
    // `{ name: 'DownloadError', code: '******' }`. That is worse than dropping
    // the field: it looks like something was captured when nothing was.
    //
    // A real 2FA/OTP code is short and numeric — exactly what the string-level
    // rule above already encodes (`/(?:code|otp)\s*[:=\s]+(\d{4,8})/`). Hold
    // this branch to the same standard: mask 4–8 digits, leave symbolic codes
    // readable, and still run the generic string redaction so an embedded
    // token in an unusual `code` value is caught.
    if (TWO_FACTOR_KEYS.has(k)) {
      return /^\d{4,8}$/.test(value.trim()) ? "******" : redactString(value);
    }
    // Partial masking for identifiers
    if (IDENTIFIER_KEYS.has(k)) {
      return maskEmail(value);
    }
    // Apply string redaction for other values
    return redactString(value);
  }

  if (typeof value === "number") {
    // Redact numeric codes
    if (TWO_FACTOR_KEYS.has(k)) return 0;
    return value;
  }

  if (typeof value === "bigint" && TWO_FACTOR_KEYS.has(k)) return 0;

  // Return objects/arrays as-is; JSON.stringify will recurse into them
  return value;
}

const MAX_DEPTH = 12;
const MAX_OBJECT_ENTRIES = 200;
const MAX_ARRAY_ENTRIES = 500;

/**
 * Attach a walked value as a true OWN property.
 *
 * Plain assignment cannot be used: `record["__proto__"] = value` invokes the
 * inherited `__proto__` setter and reparents the result object instead of
 * creating a property on it, so a logged payload carrying a `__proto__` key
 * silently mutated the prototype of the object handed back to the console.
 * `defineProperty` always creates an own data property, whatever the name.
 */
function defineEntry(record: Record<string, unknown>, property: string, value: unknown): void {
  Object.defineProperty(record, property, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Flatten an Error into a plain record, preserving the fields that make an
 * error diagnostic while routing every value through the redacting walker.
 */
function errorToTree(error: Error, seen: WeakSet<object>, depth: number): Record<string, unknown> {
  const source = error as Error & { cause?: unknown; errors?: unknown };
  const record: Record<string, unknown> = {
    name: redactString(String(source.name ?? "Error")),
    message: redactString(String(source.message ?? "")),
  };
  if (source.stack) record.stack = redactString(String(source.stack));

  // `name`/`message`/`stack` are normally non-enumerable, but a subclass that
  // assigns `this.name` in its constructor makes them own enumerable keys.
  // Skip those so the redacted versions above are not overwritten with raw ones.
  //
  // Bounded by MAX_OBJECT_ENTRIES like any other object: an Error carrying a
  // very large number of own properties would otherwise walk all of them.
  const keys = Object.keys(source).filter(
    (property) => property !== "name" && property !== "message" && property !== "stack",
  );
  const limit = Math.min(keys.length, MAX_OBJECT_ENTRIES);
  for (let index = 0; index < limit; index++) {
    const property = keys[index];
    defineEntry(
      record,
      property,
      safeTree(property, (source as unknown as Record<string, unknown>)[property], seen, depth + 1),
    );
  }
  if (keys.length > limit) record["[truncated]"] = `${keys.length - limit} more entries`;
  if (source.cause !== undefined) record.cause = safeTree("cause", source.cause, seen, depth + 1);
  if (source.errors !== undefined) record.errors = safeTree("errors", source.errors, seen, depth + 1);
  return record;
}

/**
 * Build a redacted, plain-data copy of a value WITHOUT serializing through
 * `JSON.stringify`.
 *
 * `JSON.stringify` invokes `toJSON()` before handing anything to its replacer,
 * so a value could move a credential onto an innocent-looking key and defeat
 * key-based redaction entirely:
 *
 *   { password: "secret", toJSON() { return { note: this.password } } }
 *
 * The replacer only ever saw `{ note: "secret" }` — key `note`, not a
 * credential — and the secret was logged verbatim. The same mechanism let an
 * Error subclass with `toJSON` bypass Error flattening, and made the old
 * BigInt retry serialize a SECOND, different `toJSON()` snapshot after the
 * first attempt threw.
 *
 * Walking the value ourselves closes all three: `toJSON` is never called, so a
 * value cannot restructure itself out of redaction. Built-ins whose `toJSON`
 * carried real meaning (Date, URL) are handled explicitly below.
 *
 * Getters ARE still invoked, matching v1 behavior; a throwing getter propagates
 * and is converted to a withheld marker by the caller.
 */
function safeTree(key: string, value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return value;

  // The credential-key guard runs FIRST, before any type dispatch. Placing it
  // after the primitive branches meant only string/number/boolean values
  // (which route through redactByKey) were masked: `{ token: 123n }`,
  // `{ token: Symbol("s") }`, and `{ token: namedFn }` each converted
  // themselves to text and returned before the guard was ever reached,
  // contradicting the documented "regardless of runtime type" contract.
  if (isCredentialKey(key)) return "***";

  const type = typeof value;
  if (type === "bigint") {
    return TWO_FACTOR_KEYS.has(normalizeKey(key)) ? 0 : `${value as bigint}n`;
  }
  if (type === "string" || type === "number" || type === "boolean") {
    return redactByKey(key, value);
  }
  if (type === "function") {
    // The name is attacker-controllable, so redact it like any other text.
    const name = (value as { name?: string }).name;
    return name ? `[Function: ${redactString(String(name))}]` : "[Function]";
  }
  if (type === "symbol") return redactString(String(value as symbol));
  if (type !== "object") return redactString(String(value));

  const object = value as object;
  if (seen.has(object)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated: max depth reached]";

  seen.add(object);
  try {
    if (object instanceof Error) return errorToTree(object, seen, depth);

    // Built-ins are read through their INTRINSIC prototype methods rather than
    // the instance's own. A subclass overriding `toISOString`, an object with
    // an own `toString`, or a URL with an own `href` getter would otherwise
    // hand us an arbitrary attacker-chosen string that bypassed redaction
    // entirely. Calling the prototype method directly ignores the override,
    // and the result is still passed through redactString.
    if (object instanceof Date) {
      const time = Date.prototype.getTime.call(object);
      return Number.isNaN(time) ? "[Invalid Date]" : Date.prototype.toISOString.call(object);
    }
    if (object instanceof RegExp) return redactString(RegExp.prototype.toString.call(object));
    if (typeof URL !== "undefined" && object instanceof URL) {
      const href = Object.getOwnPropertyDescriptor(URL.prototype, "href")?.get?.call(object);
      return redactString(String(href ?? "[URL]"));
    }
    // Map and Set serialize to `{}` under JSON.stringify, which is what v1
    // emitted. Keep that rather than newly exposing their contents.
    if (object instanceof Map || object instanceof Set) return {};

    if (Array.isArray(object)) {
      const limit = Math.min(object.length, MAX_ARRAY_ENTRIES);
      const items: unknown[] = [];
      for (let index = 0; index < limit; index++) {
        items.push(safeTree(String(index), object[index], seen, depth + 1));
      }
      if (object.length > limit) items.push(`[Truncated: ${object.length - limit} more entries]`);
      return items;
    }

    const record: Record<string, unknown> = {};
    const keys = Object.keys(object);
    const limit = Math.min(keys.length, MAX_OBJECT_ENTRIES);
    for (let index = 0; index < limit; index++) {
      const property = keys[index];
      defineEntry(record, property, safeTree(property, (object as Record<string, unknown>)[property], seen, depth + 1));
    }
    if (keys.length > limit) record["[truncated]"] = `${keys.length - limit} more entries`;
    return record;
  } finally {
    // Path-scoped rather than global, so the same object appearing twice in a
    // tree is rendered twice instead of being falsely reported as a cycle.
    seen.delete(object);
  }
}

function redactedClone(key: string, value: object): unknown {
  try {
    return safeTree(key, value, new WeakSet<object>(), 0);
  } catch {
    let type = "value";
    try {
      type = Object.prototype.toString.call(value);
    } catch {
      // Even type inspection can invoke a hostile Symbol.toStringTag getter.
    }
    return `[unserializable ${type} — withheld to avoid logging unredacted data]`;
  }
}

/**
 * Redact values based on their key names
 * @param key The property key name
 * @param value The value to potentially redact
 * @returns Redacted value if key indicates sensitive data
 */
export function redactValueByKey(key: string, value: unknown): unknown {
  if (value == null) return value;

  // For objects, walk a redacted plain-data copy.
  if (typeof value === "object") {
    if (isCredentialKey(key)) return "***";
    return redactedClone(key, value);
  }

  // For primitives, use the key-based redaction directly
  return redactByKey(key, value);
}

/**
 * Sanitize an array of arguments for safe logging
 * @param args Array of arguments that may contain sensitive data
 * @returns Sanitized array safe for logging
 */
export function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === "string") return redactString(arg);
    if (typeof arg === "object" && arg !== null) {
      // Never return the original object on failure: callers trust this
      // function precisely because it must not fail open.
      return redactedClone("", arg);
    }
    if (typeof arg === "bigint") return `${arg}n`;
    return arg;
  });
}
