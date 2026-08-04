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
| `enableRedaction` | `boolean` | `true` | Whether to enable automatic redaction |
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
```

## What Gets Redacted?

Redaction works two ways: **by key name** (for object properties in `args` and `inspect()`) and **by string pattern** (anywhere a value's text matches a known shape).

**By key name** — properties whose key matches one of these are fully masked to `***`:

- **Passwords / secrets**: `password`, `pass`, `pwd`, `secret`, `applepassword`, `apple_password`, `clientSecret`, `privateKey`, `signingKey`
- **Tokens / API keys**: `token`, `auth`, `authorization`, `bearer`, `key`, `apiKey`, `accessToken`, `apiToken`, `refreshToken`, `idToken`, `oauthToken`
- **2FA codes**: `code`, `otp`, `2fa`, `twofactor`, `two_factor`, `verificationCode`, `oneTimeCode` → masked to `******` (numeric codes become `0`)
- **Identifiers** (partially masked): `email`, `appleid`, `apple_id`, `username`, `user` → e.g. `u***@example.com`

Key matching is **case-insensitive** and treats camelCase, snake_case, kebab-case, and space-separated spellings consistently, but remains exact — `apiKey` and `api_key` are redacted, while `apiKeyValue` and `myApiKey` are not (their string contents may still be caught by the patterns below). Credential keys are masked regardless of whether their value is a string, number, boolean, or object.

**By string pattern** — applied to every logged string and to string values regardless of key:

- **Labeled secrets**: `password=...`, `token: ...`, `secret=...`, etc. → value masked
- **Bearer tokens**: `Bearer <token>` → `Bearer ***`
- **Labeled 2FA codes**: `code: 1234`, `otp=567890` → digits masked
- **Emails**: partially masked (e.g., `u***@example.com`)
- **Long hex strings**: 32+ characters containing both digits and hexadecimal letters (potential tokens/hashes)
- **Base64-like strings**: 20+ characters in complete base64 blocks with a digit, `+`, `/`, or padding signal

Benign URLs are preserved byte-for-byte and excluded from the hex/base64 patterns. Userinfo credentials and sensitive query or fragment parameters such as `access_token`, `api_key`, `client_secret`, and `password` are masked in whole URLs and URLs embedded in messages.

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
