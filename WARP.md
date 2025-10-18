# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common Development Commands

Using **npm** (detected from `package-lock.json`).

- **Install dependencies:**
  ```bash
  npm install
  ```

- **Build the package:**
  ```bash
  npm run build
  ```

- **Watch for changes (development):**
  ```bash
  npm run watch
  ```

- **Create distribution tarball:**
  ```bash
  npm pack
  ```

- **Publish to npm:**
  ```bash
  # For first-time publication
  npm publish --access public

  # For subsequent releases (bumps version automatically)
  npm version patch  # or minor / major
  npm publish
  ```

- **Clean build output:**
  ```bash
  npm run clean
  ```

**Note:** No lint, type-check, or test scripts are configured in this package. Type checking is enforced via `tsconfig.json` with `strict: true` at build time.

## High-Level Architecture

`@chrismessina/raycast-logger` is a compact, focused npm package exporting three core modules:

### Module Composition

1. **`src/logger.ts`** – Logger class and singleton instance
   - Exports `Logger` class for custom instances and `logger` singleton via `Logger.getInstance()`
   - Implements three log levels:
     - `log(message, ...args)` – Respects `verboseLogging` preference; skipped if disabled
     - `error(message, ...args)` – Always visible
     - `warn(message, ...args)` – Always visible
   - Supports `child(prefix: string)` to create prefixed child loggers for namespace organization
   - Accepts `LoggerConfig` to customize verbosity check, prefix, and redaction toggle

2. **`src/redaction.ts`** – Automatic sanitization of sensitive data
   - Exports `redactString(input: string)` – Redacts secrets in string values using regex patterns
   - Exports `sanitizeArgs(args: unknown[])` – Recursively redacts objects and arrays before logging
   - Redaction pipeline (in order of application):
     - Bearer tokens (`Bearer ***`)
     - Key-value secrets: `password=***`, `token=***`, `apiKey=***`, etc.
     - 2FA codes (6–8 digits masked as `******`)
     - Long hex/base64 strings (32+ chars or 20+ base64 chars assumed to be hashes/tokens)
     - Email addresses (first char + `***` + domain: `u***@example.com`)
   - Depth-aware object traversal: recursively inspects nested objects and arrays

3. **`src/index.ts`** – Public API surface
   - Re-exports `Logger`, `logger`, `LoggerConfig`, `LoggerPreferences`
   - Re-exports utility functions `redactString` and `sanitizeArgs`
   - Minimal, stable interface for Raycast extensions

### Design Patterns

- **Singleton via `getInstance()`:** The default `logger` export uses a lazy-initialized singleton, ensuring a single instance per process. Custom instances can be created via `new Logger(config)`.
- **Preference Integration:** Logger reads the extension's `verboseLogging` preference (boolean) from Raycast at runtime; gracefully defaults to `false` if preference read fails.
- **Composable Child Loggers:** `logger.child("[Auth]")` returns a new Logger with prepended prefix; prefixes nest when chaining.
- **Conditional Redaction:** Redaction is enabled by default but can be disabled in `LoggerConfig` for testing or specialized use cases.

## Key Architectural Decisions

1. **Singleton Pattern**
   - Reduces coupling; extensions import a single `logger` instance without dependency injection.
   - Custom instances supported via `new Logger(config)` for non-standard environments or testing.

2. **Preference-Driven Logging**
   - `log()` is cheap to call even with verbose disabled; decision deferred to `isVerboseEnabled()`.
   - Errors and warnings always print, helping with production debugging.

3. **Redaction Strategy**
   - **Key-based redaction (objects):** Inspects object keys (case-insensitive) to decide redaction depth.
   - **Pattern-based redaction (strings):** Uses regex to catch bearer tokens, key=value secrets, hex/base64 patterns.
   - **Recursive traversal:** Handles nested structures safely using JSON stringify/parse roundtrip with a custom replacer.
   - **Performance:** Redaction is applied only when logging is active; disabled via config for throughput-sensitive paths.

4. **Stable Public API**
   - Export surface is intentionally minimal to avoid breaking changes in consuming Raycast extensions.
   - Types (`LoggerPreferences`, `LoggerConfig`) are stable interfaces consumers can extend.

## TypeScript and Raycast Ecosystem

- **Strict Mode:** `tsconfig.json` enforces `strict: true`, `noImplicitAny`, and declaration map generation.
- **No `any` types allowed.** All types must be explicit; use utility types or interface extension if needed.
- **Peer Dependency:** Requires `@raycast/api ^1.0.0` to run (not at build time). Consumers must provide it.
- **Module Format:** CommonJS output (`module: "commonjs"`, `target: "ES2020"`) with `.d.ts` declaration files. Main entry point is `dist/index.js`; types at `dist/index.d.ts`.
- **Imports in Extensions:**
  ```typescript
  import { logger, Logger, type LoggerPreferences } from "@chrismessina/raycast-logger";

  // Extend LoggerPreferences in your extension's preferences interface
  export interface MyExtensionPreferences extends LoggerPreferences {
    apiKey: string;
    // ... other prefs
  }
  ```

### Local Testing in a Raycast Extension

To test unreleased changes in a consuming Raycast extension:

1. **In the logger package directory:**
   ```bash
   npm run build
   npm link
   ```

2. **In the consuming extension directory:**
   ```bash
   npm link @chrismessina/raycast-logger
   ```

3. **Ensure the extension has `@raycast/api` installed** and the `verboseLogging` preference configured in `package.json`.

4. **Run the extension in development:**
   ```bash
   # From the extension directory
   npm run dev
   # or
   ray dev
   ```

5. **Enable "Verbose Logging" in extension preferences** and check the console for logs.

**To unlink:**
```bash
# In the extension
npm unlink @chrismessina/raycast-logger

# In the logger package
npm unlink
```

## Important Constraints

- **Do not use `any` types** in TypeScript code; Raycast does not allow them.
- **Ensure `prepublishOnly` script runs before npm publish** to build `dist/` automatically.
- **Version bumps via `npm version`** before publishing to keep git tags and package.json in sync.
- Extensions consuming this package must provide `@raycast/api` in their own dependencies.

## Redaction Patterns

Automatically redacted fields in objects (key-based):
- **Complete redaction (→ `"***"`):** `password`, `pass`, `pwd`, `secret`, `token`, `auth`, `authorization`, `applepassword`
- **Numeric redaction (→ `0`):** `code`, `otp`, `2fa` (numeric values)
- **Email masking (→ `u***@example.com`):** `email`, `appleid`, `apple_id`, `username`, `user`

Automatically redacted patterns in strings (regex-based):
- Bearer tokens: `Bearer abc123` → `Bearer ***`
- Key-value pairs: `password=secret123` → `password=***`
- 2FA codes: `code=123456` → `code=******`
- Hex strings: 32+ characters assumed token/hash
- Base64 strings: 20+ characters assumed encoded secret

## Documentation References

- **README.md** – Full API reference, usage examples, and type definitions.
- **QUICKSTART.md** – 3-step setup for consuming extensions.
- **CHANGELOG.md** – Version history and feature tracking.
