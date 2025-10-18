# @chrismessina/raycast-logger

A secure, preference-driven logger for Raycast extensions with automatic redaction of sensitive data.

## Features

- 🔒 **Automatic Redaction**: Sanitizes passwords, tokens, API keys, emails, and 2FA codes
- ⚙️ **Preference-Driven**: Respects Raycast extension's `verboseLogging` preference
- 🎯 **Type-Safe**: Full TypeScript support with comprehensive type definitions
- 🪵 **Flexible**: Singleton pattern with support for custom configurations
- 🎨 **Child Loggers**: Create scoped loggers with custom prefixes
- 📦 **Zero Dependencies**: Only requires `@raycast/api` as a peer dependency

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

// Always shown (errors and warnings)
logger.error("Authentication failed", { error: "Invalid credentials" });
logger.warn("Rate limit approaching", { remaining: 10 });
```

## Usage Examples

### Basic Logging

```typescript
import { logger } from "@chrismessina/raycast-logger";

// This only logs if verboseLogging preference is enabled
logger.log("User logged in", { 
  email: "user@example.com",  // Automatically redacted to "u***@example.com"
  password: "secret123"        // Automatically redacted to "***"
});

// These always log, regardless of preference
logger.error("Failed to fetch data", error);
logger.warn("Deprecated API usage detected");
```

### Automatic Redaction

The logger automatically redacts sensitive information:

```typescript
logger.log("Auth attempt", {
  email: "user@example.com",      // → "u***@example.com"
  password: "mypassword",         // → "***"
  token: "abc123def456",          // → "***"
  apiKey: "sk_live_123456",       // → "***"
  code: "123456",                 // → "******"
  bearerToken: "Bearer xyz789"    // → "Bearer ***"
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

### Custom Configuration

For advanced use cases, create a custom logger instance:

```typescript
import { Logger } from "@chrismessina/raycast-logger";

const customLogger = new Logger({
  prefix: "[MyExtension]",
  isVerboseEnabled: () => true,  // Always log (ignore preference)
  enableRedaction: false         // Disable redaction (not recommended)
});

customLogger.log("This always logs with custom prefix");
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
logger.log(message: string, ...args: unknown[]): void
logger.error(message: string, ...args: unknown[]): void
logger.warn(message: string, ...args: unknown[]): void
logger.child(prefix: string): Logger
```

### `Logger`

Logger class for creating custom instances.

```typescript
new Logger(config?: LoggerConfig)
```

**LoggerConfig Options:**

- `isVerboseEnabled?: () => boolean` - Custom function to check if verbose logging is enabled
- `prefix?: string` - Prefix to add to all log messages
- `enableRedaction?: boolean` - Whether to enable automatic redaction (default: `true`)

### Utility Functions

```typescript
import { redactString, sanitizeArgs } from "@chrismessina/raycast-logger";

// Redact sensitive data from a string
const safe = redactString("password=secret123"); // → "password=***"

// Sanitize an array of arguments
const safeArgs = sanitizeArgs([{ token: "abc123" }]); // → [{ token: "***" }]
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

## Best Practices

1. **Use `logger.log()` for debug info** - It respects the user's preference
2. **Use `logger.error()` for errors** - Always visible to help with debugging
3. **Use `logger.warn()` for warnings** - Always visible for important notices
4. **Create child loggers** - Use prefixes to organize logs by feature/module
5. **Keep redaction enabled** - Protect user privacy by default

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
