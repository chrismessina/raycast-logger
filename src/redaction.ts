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
 * Treat camelCase, snake_case, kebab-case, and space-separated key spellings
 * consistently without broad substring matching (for example, `tokenizer`
 * must not be treated as `token`).
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]+/g, "");
}

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEYS.has(normalizeKey(key));
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

  return output.replace(/([?&#])([^=&#]+)=([^&#]*)/g, (match, separator: string, rawKey: string) => {
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    } catch {
      // A malformed escape must never make logging throw. The undecoded key
      // still gets checked, and later string rules provide a second chance.
    }
    return isCredentialKey(key) ? `${separator}${rawKey}=***` : match;
  });
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
  s = s.replace(
    /(["']?)\b(password|pass|pwd|secret|token|auth|authorization|key|api[_-]?key|access[_-]?token|api[_-]?token|client[_-]?secret|refresh[_-]?token|id[_-]?token|oauth[_-]?token|private[_-]?key|signing[_-]?key|apple[_-]?password)\b\1(\s*[:=]\s*)(["'])(?:\\.|(?!\4)[^\\\r\n])*\4/gi,
    "$1$2$1$3$4***$4",
  );
  s = s.replace(
    /(["']?)\b(password|pass|pwd|secret|token|auth|authorization|key|api[_-]?key|access[_-]?token|api[_-]?token|client[_-]?secret|refresh[_-]?token|id[_-]?token|oauth[_-]?token|private[_-]?key|signing[_-]?key|apple[_-]?password)\b\1(\s*[:=]\s*)[^\s&,;"')\]}]+/gi,
    "$1$2$1$3***",
  );
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
    /(\b(?:code|2fa|two[-\s]?factor|otp)\b(?:\s+\w+){0,3}\s*[:=\s]\s*)(\d{4,8})(?!\d)/gi,
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
  if (CREDENTIAL_KEYS.has(k)) return "***";

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

function prepareForJson(key: string, value: unknown): unknown {
  if (value instanceof Error) {
    const error = value as Error & { cause?: unknown; errors?: unknown };
    const record: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) record.stack = error.stack;
    if (error.cause !== undefined) record.cause = error.cause;
    if (error.errors !== undefined) record.errors = error.errors;
    for (const property of Object.keys(error)) record[property] = (error as unknown as Record<string, unknown>)[property];
    return redactByKey(key, record);
  }
  return redactByKey(key, value);
}

function redactedJsonClone(value: object): unknown {
  try {
    const json = JSON.stringify(value, (key, nestedValue) => prepareForJson(key, nestedValue));
    if (json === undefined) return "[unserializable value — withheld]";
    return JSON.parse(json);
  } catch {
    // Retry below with explicit BigInt conversion.
  }

  try {
    const json = JSON.stringify(value, (key, nestedValue) => {
      const redacted = prepareForJson(key, nestedValue);
      return typeof redacted === "bigint" ? `${redacted}n` : redacted;
    });
    if (json === undefined) return "[unserializable value — withheld]";
    return JSON.parse(json);
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

  // For objects, use JSON.stringify with the safe replacer
  if (typeof value === "object") {
    if (isCredentialKey(key)) return "***";
    return redactedJsonClone(value);
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
      return redactedJsonClone(arg);
    }
    if (typeof arg === "bigint") return `${arg}n`;
    return arg;
  });
}
