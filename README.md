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

// Always shown (errors, warnings, info)
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

| Method | Visibility | Color | Use Case |
|--------|------------|-------|----------|
| `error()` | Always | Red | Failures, exceptions |
| `warn()` | Always | Yellow | Important notices, deprecations |
| `info()` | Always | Blue | Operational messages |
| `log()` | Verbose only | Cyan | General debug output |
| `debug()` | Verbose only | Gray | Detailed diagnostics |

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
// Output: [2026-01-05T10:30:00.000Z] [handler.ts:42] [INFO] Request received
```

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

// Always-shown methods
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

The logger automatically redacts:

- **Passwords**: `password`, `pass`, `pwd`, `secret`
- **Tokens**: `token`, `auth`, `authorization`, `bearer`
- **API Keys**: `key`, `apiKey`, `apikey`
- **2FA Codes**: `code`, `otp`, `2fa`, `twofactor`
- **Emails**: Partially masked (e.g., `u***@example.com`)
- **Long hex strings**: 32+ characters (potential tokens/hashes)
- **Base64 strings**: 20+ characters (potential encoded secrets)

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
3. **Use `logger.info()` for operational messages** - Always visible, non-error info
4. **Use `logger.error()` for errors** - Always visible to help with debugging
5. **Use `logger.warn()` for warnings** - Always visible for important notices
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

Issues and pull requests are welcome! Visit the [GitHub repository](https://github.com/chrismessina/raycast-logger).
