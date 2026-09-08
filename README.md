# @chrismessina/raycast-logger

A secure, preference-driven logger for Raycast extensions with automatic redaction of sensitive data.

## Features

- **Automatic Redaction**: Sanitizes passwords, tokens, API keys, emails, and 2FA codes
- **Preference-Driven**: Respects Raycast extension's `verboseLogging` preference
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **Flexible**: Singleton pattern with support for custom configurations
- **Child Loggers**: Create scoped loggers with custom prefixes
- **Colorized Output**: ANSI color-coded log levels for easy scanning
- **LLM-Friendly**: Built-in features for AI-assisted debugging sessions
- **Zero Dependencies**: Only requires `@raycast/api` as a peer dependency

## Installation

```bash
npm install @chrismessina/raycast-logger
```

## Quick Start

### 1. Add Preference to Your Extension

In your `package.json`, add a `verboseLogging` preference:

```json
{
  "preferences": [
    {
      "name": "verboseLogging",
      "type": "checkbox",
      "required": false,
      "title": "Verbose Logging",
      "label": "Enable detailed logging",
      "description": "Show detailed logs in the console for debugging",
      "default": false
    }
  ]
}
```

### 2. Use the Logger

```typescript
import { logger } from "@chrismessina/raycast-logger";

// Verbose logs (only shown when preference is enabled)
logger.log("Processing request", { userId: 123 });
logger.debug("Cache state", { hits: 42, misses: 3 });

// Emitted regardless of the verbose preference (errors, warnings, info)
logger.error("Authentication failed", { error: "Invalid credentials" });
logger.warn("Rate limit approaching", { remaining: 10 });
logger.info("Extension initialized", { version: "1.0.0" });
```

## Usage Examples

### Basic Logging

```typescript
import { logger } from "@chrismessina/raycast-logger";

// These only log if verboseLogging preference is enabled
logger.log("User logged in", {
  email: "user@example.com",  // Automatically redacted to "u***@example.com"
  password: "secret123"        // Automatically redacted to "***"
});
logger.debug("Detailed diagnostics", { cache: "hit" });

// These always log, regardless of preference
logger.error("Failed to fetch data", error);
logger.warn("Deprecated API usage detected");
logger.info("Server connected", { host: "api.example.com" });
```

### Log Levels

| Method | Emitted | Color | Use Case |
|--------|---------|-------|----------|
| `error()` | Regardless of preference | Red | Failures, exceptions |
| `warn()` | Regardless of preference | Yellow | Important notices, deprecations |
| `info()` | Regardless of preference | Blue | Operational messages |
| `log()` | Verbose only | Cyan | General debug output |
| `debug()` | Verbose only | Gray | Detailed diagnostics |

> **Emitted is not the same as visible.** "Regardless of preference" means the logger calls the corresponding `console` method without checking `verboseLogging` — it does not mean the output reaches a screen. Raycast disables console logging for extensions installed from the Store, so these calls are visible during development (`ray develop`) but not to end users. Use them for developer diagnostics, and surface anything a user needs to act on through a Toast or an error view instead.

### Automatic Redaction

The logger automatically redacts sensitive information:

```typescript
logger.log("Auth attempt", {
  email: "user@example.com",      // -> "u***@example.com"
  password: "mypassword",         // -> "***"
  token: "abc123def456",          // -> "***"
  apiKey: "sk_live_123456",       // -> "***"
  code: "123456",                 // -> "******"
  bearerToken: "Bearer xyz789"    // -> "Bearer ***"
});
```

### Strict Redaction

Standard redaction is keyed on *names* — `password`, `token`, `?access_token=`. It
cannot see a sensitive value under an unremarkable name: `?sid=…`, `?u=…`, a document
id in a query string. Strict redaction is the blunt answer for that case: every URL
**query string and fragment** is replaced by a marker, on top of everything standard
does.

```typescript
logger.log("GET https://api.example.com/v1/items/abc123?page=2&sid=SECRET");
// standard -> GET https://api.example.com/v1/items/abc123?page=2&sid=SECRET
// strict   -> GET https://api.example.com/v1/items/abc123?***
```

It is **off by default**, because a query string is often the thing being diagnosed.
A debug log that omits the input is not a safer log; it is a useless one. The person
who knows a log is going to leave the machine — pasted into an issue, sent to a
maintainer — is the user, not the extension author. So it is exposed as a **user
preference**. Add it to your `package.json` next to `verboseLogging`:

```json
{
  "name": "strictRedaction",
  "type": "checkbox",
  "required": false,
  "title": "Strict Redaction",
  "label": "Also hide URL query strings and fragments in logs",
  "description": "Enable before reproducing an issue, then share only the lines written afterwards. Masks every URL query string and fragment, including values that automatic redaction cannot recognize by name. Does not change lines already in the console.",
  "default": false
}
```

An extension can also set the level in code:

```typescript
new Logger({ enableRedaction: "strict" });   // true and "standard" are the same level
```

**The preference is read per call**, so it affects only lines written after it is
turned on. It cannot clean up console output that already exists. The instruction to
users is therefore *enable, then reproduce, then share only the new lines* — not
"turn it on before pasting" — and the description in the block above says so, because
every extension that pastes it ships that sentence.

**Precedence:** the user preference wins. When `strictRedaction` is on, the effective
level is strict even if the extension configured `enableRedaction: false` — the user's
privacy control beats the author's convenience. When the preference cannot be read, the
configured level is used, *including* `false`; that is a fallback to the author's
policy, not fail-closed.

**Exact behavior.** Query and fragment are masked independently, each to a single
marker; userinfo and path are untouched; everything standard masks is still masked:

| Input | Strict output |
| --- | --- |
| `https://h/p?a=1&sid=x` | `https://h/p?***` |
| `https://h/p#section` | `https://h/p#***` |
| `https://h/p?a=1#section` | `https://h/p?***#***` |
| `https://h/p?next=https://i/cb?t=1` | `https://h/p?***` |
| `https://user:secret@h/p?q=1` | `https://***:***@h/p?***` |
| `https://h/p/q` | `https://h/p/q` |

This applies wherever a URL can reach the console: message strings, structured
values under any key, `URL` instances, `Error` messages and stacks, `RegExp` sources,
property *names*, the prefix, step identifiers, and `inspect()` labels. Two known
limits are inherited from the URL matcher and are pinned by tests rather than fixed:
an IPv6 host (`https://[::1]/…`) is not recognized as a URL, and a `)` inside a query
ends the match early.

Strict mode does **not** mask path segments on their shape. A high-entropy path
segment is an ID, not a secret, and masking it turns forty distinct requests into
forty identical lines — which is exactly the failure 1.4.0 fixed.

### Child Loggers with Prefixes

Create scoped loggers for different parts of your extension:

```typescript
import { logger } from "@chrismessina/raycast-logger";

const authLogger = logger.child("[Auth]");
const apiLogger = logger.child("[API]");

authLogger.log("Login attempt");  // Output: [Auth] Login attempt
apiLogger.log("Fetching data");   // Output: [API] Fetching data
```

### Timestamps and Context

Enable timestamps and file context for detailed debugging:

```typescript
import { Logger } from "@chrismessina/raycast-logger";

const logger = new Logger({
  showTimestamp: true,   // Add ISO timestamps
  showContext: true,     // Add file:line info
});

logger.info("Request received");
// Output: [INFO] [2026-01-05T10:30:00.000Z] [handler.ts:42] Request received
```

The level label (`[INFO]`, `[ERROR]`, `[WARN]`) is printed first, followed by the timestamp, file context, and prefix.

### Performance Profiling

Measure operation duration with the `time()` method:

```typescript
const done = logger.time("API request");
const response = await fetch("https://api.example.com/data");
done(); // Output: API request completed in 150.23ms

// With additional context
const queryDone = logger.time("Database query");
const results = await db.query("SELECT * FROM users");
queryDone({ rows: results.length }); // Output: Database query completed in 45.00ms { rows: 100 }
```

### LLM-Friendly Features

Built-in methods designed to help AI assistants understand your code execution:

#### Step-by-Step Logging

```typescript
async function processOrder(orderId: string) {
  logger.step(1, "Validating order", { orderId });
  await validateOrder(orderId);

  logger.step(2, "Processing payment");
  await processPayment(orderId);

  logger.step(3, "Sending confirmation");
  await sendConfirmation(orderId);
}
// Output:
// [Step 1] Validating order { orderId: "123" }
// [Step 2] Processing payment
// [Step 3] Sending confirmation
```

#### Object Inspection

```typescript
logger.inspect("API Response", response);
// Output:
// === API Response ================================
// {
//   "status": 200,
//   "data": {
//     "user": { ... }
//   }
// }
// === End API Response ============================
```

### Custom Configuration

For advanced use cases, create a custom logger instance:

```typescript
import { Logger } from "@chrismessina/raycast-logger";

const customLogger = new Logger({
  prefix: "[MyExtension]",
  isVerboseEnabled: () => true,  // Always log (ignore preference)
  enableRedaction: true,         // Redact sensitive data (default)
  showTimestamp: true,           // Include timestamps
  showContext: true,             // Include file:line info
  colorize: true,                // Colorized output (default)
});
```

### Disabling Colors

For environments that don't support ANSI codes or for cleaner log files:

```typescript
const logger = new Logger({
  colorize: false,  // Plain text output
});
```

### TypeScript Support

Define your extension preferences with the logger preference:

```typescript
import { LoggerPreferences } from "@chrismessina/raycast-logger";

interface MyExtensionPreferences extends LoggerPreferences {
  apiKey: string;
  downloadPath: string;
  // ... other preferences
}

const preferences = getPreferenceValues<MyExtensionPreferences>();
```

## API Reference

### `logger`

Default singleton logger instance. Uses extension preferences automatically.

```typescript
// Verbose-only methods
logger.log(message: string, ...args: unknown[]): void
logger.debug(message: string, ...args: unknown[]): void
logger.step(step: number | string, description: string, data?: Record<string, unknown>): void
logger.inspect(label: string, value: unknown): void
logger.time(label: string): (meta?: Record<string, unknown>) => void

// Emitted regardless of the verbose preference
logger.error(message: string, ...args: unknown[]): void
logger.warn(message: string, ...args: unknown[]): void
logger.info(message: string, ...args: unknown[]): void

// Utilities
logger.child(prefix: string): Logger
```

### `Logger`

Logger class for creating custom instances.

```typescript
new Logger(config?: LoggerConfig)
```

**LoggerConfig Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `isVerboseEnabled` | `() => boolean` | Uses preferences | Custom function to check if verbose logging is enabled |
| `prefix` | `string` | `""` | Prefix to add to all log messages |
| `enableRedaction` | `boolean \| "standard" \| "strict"` | `true` | Redaction level. `true` and `"standard"` are the same; `"strict"` also masks URL query strings and fragments (see [Strict Redaction](#strict-redaction)); `false` disables redaction. The `strictRedaction` user preference overrides this. |
| `showTimestamp` | `boolean` | `false` | Include ISO timestamps in output |
| `showContext` | `boolean` | `false` | Include file:line context (LLM-friendly) |
| `colorize` | `boolean` | `true` | Enable ANSI color codes |

### Utility Functions

```typescript
import { redactString, sanitizeArgs } from "@chrismessina/raycast-logger";

// Redact sensitive data from a string
const safe = redactString("password=secret123"); // -> "password=***"

// Sanitize an array of arguments
const safeArgs = sanitizeArgs([{ token: "abc123" }]); // -> [{ token: "***" }]

// Both take an optional level; the default is "standard"
redactString("GET https://h/p?sid=x", { level: "strict" }); // -> "GET https://h/p?***"
sanitizeArgs([{ url: "https://h/p?sid=x" }], { level: "strict" }); // -> [{ url: "https://h/p?***" }]
```

Exported types: `LoggerConfig`, `LoggerPreferences`, `RedactionLevel` (`"standard" | "strict"`), `RedactionOptions` (`{ level?: RedactionLevel }`).

## What Gets Redacted?

Redaction works two ways: **by key name** (for object properties in `args` and `inspect()`) and **by string pattern** (anywhere a value's text matches a known shape).

**By key name** — properties whose key matches one of these are fully masked to `***`:

- **Passwords / secrets**: `password`, `pass`, `pwd`, `secret`, `applepassword`, `apple_password`, `clientSecret`, `privateKey`, `signingKey`
- **Tokens / API keys**: `token`, `auth`, `authorization`, `bearer`, `key`, `apiKey`, `accessToken`, `apiToken`, `refreshToken`, `idToken`, `oauthToken`
- **2FA codes**: `code`, `otp`, `2fa`, `twofactor`, `two_factor`, `verificationCode`, `oneTimeCode` → masked to `******` (numeric codes become `0`)
- **Identifiers** (partially masked): `email`, `appleid`, `apple_id`, `username`, `user` → e.g. `u***@example.com`

Key matching is **case-insensitive** and treats camelCase, snake_case, kebab-case, and space-separated spellings consistently. Credential keys are masked regardless of whether their value is a string, number, boolean, or object — an object parked under a credential key is masked whole, never traversed.

**Compound keys** are matched on their *head noun* — the last word — so environment-style names are covered:

| Key | Masked? | Why |
|-----|---------|-----|
| `NPM_TOKEN`, `GITHUB_TOKEN`, `DB_PASSWORD` | yes | head noun is `token` / `password` |
| `myApiKey`, `MY_API_KEY`, `stripeApiKey` | yes | head noun is the two-word term `apiKey` |
| `DB_PASS`, `DB_AUTH` | yes | head noun is `pass` / `auth` |
| `authorizationHeader`, `tokenValue` | yes | contains an unambiguous credential word |
| `cacheKey`, `sortKey`, `partitionKey`, `publicKey` | **no** | head noun is bare `key`, which is overloaded and rarely a secret |
| `apiKeyValue` | **no** | head noun is `value`, and `key` alone doesn't qualify |
| `statusCode`, `errorCode`, `exitCode` | **no** | `code` is excluded — see `error.code` below |
| `tokenizer`, `monkey`, `passenger` | **no** | single word; `token`/`key`/`pass` is a fragment, not a segment |

Matching works on three rules, in order: an exact whole-key match; the **head noun** (final segment, or final two joined); or an unambiguous credential word **anywhere** in the key. Segmentation splits on `_`, `-`, `.`, spaces, and camelCase — including acronym boundaries, so `DBPassword` and `NPMToken` segment correctly.

**The same function decides for both paths.** Message-level redaction (`token=...` in a log string) and structured redaction (`{ token: ... }`) consult one shared rule, so they cannot disagree about what counts as a credential. One exception: key names longer than 512 characters are matched in structured data but not in messages — a deliberate cap that keeps the message matcher linear on adversarial input.

The distinction between "head only" and "anywhere" is deliberate. `pass` and `auth` qualify only as a head, so `DB_PASS` masks while `passThrough` and `authFlow` do not. `key` and `code` never qualify as compound terms at all — masking `cacheKey` or `error.code` would destroy exactly the diagnostics this package exists to preserve — though both still mask on an exact whole-key match.

The cost is accepted knowingly: `cancellationToken` and `refreshTokenExpiresAt` are masked despite not being secrets. Masking a non-secret loses a diagnostic; missing a secret leaks it.

**By string pattern** — applied to every logged string and to string values regardless of key:

- **Labeled secrets**: `password=...`, `token: ...`, `secret=...`, and env-style `NPM_TOKEN=...` → value masked
- **Bearer tokens**: `Bearer <token>` → `Bearer ***`
- **Labeled 2FA codes**: `code: 1234`, `otp=567890` → digits masked
- **Emails**: partially masked (e.g., `u***@example.com`)
- **Long hex strings**: 32+ characters containing both digits and hexadecimal letters (potential tokens/hashes)
- **Base64-like strings**: 20+ characters in complete base64 blocks with a digit, `+`, `/`, or padding signal

Benign URLs are preserved byte-for-byte and excluded from the hex/base64 patterns. Userinfo credentials and sensitive query or fragment parameters such as `access_token`, `api_key`, `client_secret`, and `password` are masked in whole URLs and URLs embedded in messages. `?`, `&`, `#`, and `;` all delimit parameters, so a credential in a **nested** URL (`?redirect=https://idp/cb?access_token=...`) or after a semicolon is masked rather than hidden inside the outer parameter's value. Under [strict redaction](#strict-redaction) the whole query and fragment are masked regardless of parameter name.

**Objects are walked directly, not serialized through `JSON.stringify`.** A custom `toJSON()` is never invoked, because it runs *before* any redaction and could move a credential onto an innocent-looking key:

```typescript
// The credential is masked even though toJSON() renames it.
logger.info("state", { password: "hunter2", toJSON() { return { note: this.password }; } });
```

`Date`, `RegExp`, and `URL` are handled explicitly so they keep their meaning, and are read through their **intrinsic prototype methods** — a subclass overriding `toISOString`, or an object with an own `href` getter, cannot hand the walker an arbitrary string that bypasses redaction. Circular references render as `[Circular]` with sibling fields preserved, and traversal is bounded (depth 12, 200 object entries, 500 array entries) with explicit truncation markers.

Getters *are* still invoked, matching v1 behavior — this is a redaction boundary, not a side-effect-free snapshotter. A throwing getter, or a function whose `name` getter throws, turns the whole argument into a fixed withheld marker (`[unserializable value — withheld to avoid logging unredacted data]`) rather than leaking it. The marker carries nothing from the value, not even its type tag, because that tag is a getter too.

Redaction is a defense-in-depth safeguard, not a substitute for avoiding secrets in logs. Ambiguous unlabeled values—especially unpadded, letters-only tokens—cannot be reliably distinguished from ordinary prose, so prefer structured objects with descriptive keys when logging potentially sensitive data.

## Color Scheme

When `colorize: true` (default):

| Element | Color |
|---------|-------|
| `[ERROR]` | Red (bold) |
| `[WARN]` | Yellow (bold) |
| `[INFO]` | Blue (bold) |
| `[DEBUG]` | Gray |
| `log()` messages | Cyan |
| `[Step N]` | Cyan (bold) |
| `inspect` headers | Magenta (bold) |
| Timestamps | Gray |
| File context | Dim |
| Prefix | Magenta |

## Best Practices

1. **Use `logger.log()` for debug info** - It respects the user's preference
2. **Use `logger.debug()` for detailed diagnostics** - Extra-verbose output
3. **Use `logger.info()` for operational messages** - Emitted regardless of preference, non-error info
4. **Use `logger.error()` for errors** - Emitted regardless of preference to help with debugging
5. **Use `logger.warn()` for warnings** - Emitted regardless of preference for important notices
6. **Use `logger.step()` for flow tracking** - Helps LLMs understand execution order
7. **Use `logger.time()` for performance** - Measure and log operation duration
8. **Create child loggers** - Use prefixes to organize logs by feature/module
9. **Keep redaction enabled** - Protect user privacy by default
10. **Enable `showContext` for LLM sessions** - Helps AI understand where code executes

## Migration from Custom Logger

If you're migrating from a custom logger implementation:

**Before:**
```typescript
import { logger } from "./utils/logger";
import { ExtensionPreferences } from "./types";
```

**After:**
```typescript
import { logger, type LoggerPreferences } from "@chrismessina/raycast-logger";

// Extend your preferences interface
interface ExtensionPreferences extends LoggerPreferences {
  // ... your other preferences
}
```

## License

MIT

## Author

Chris Messina

## Contributing

Issues and pull requests are welcome! Run `npm test` before submitting changes. Security reports should follow the [security policy](SECURITY.md) rather than being filed publicly.
