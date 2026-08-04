# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-08-03

Redaction hardening and the first regression suite. No API was added or removed;
existing imports and call sites are unchanged. This is a minor rather than a
patch release because several fail-open paths now fail closed, which changes
what is printed for hostile or unserializable values — see *Behavior changes*.

### Security

- Redact credentials embedded in URL userinfo and sensitive query parameters while preserving benign URLs.
- Fail closed when sanitizing circular or otherwise unserializable values instead of returning the original object. Previously `sanitizeArgs` and `redactValueByKey` returned the **unredacted original** when `JSON.stringify` threw, so a cyclic object containing a secret was logged in full.
- Redact credential-keyed values regardless of their runtime type. A credential key holding a number, boolean, or nested object is now masked; previously only string values were.
- Redact the `inspect()` label, which was printed verbatim.
- Sanitize the logger's own internal error reporting, which previously passed a raw caught error to `console.error`.
- Contain a throwing `isVerboseEnabled` callback instead of letting it propagate into caller code.

### Fixed

- Preserve `:` versus `=` and surrounding formatting in structured log lines.
- Avoid treating long decimal IDs and ordinary alphabetic words as base64 secrets.
- Treat snake_case, kebab-case, camelCase, and space-separated credential keys consistently, including `apple_password`.
- Apply the same 2FA key set to numeric and string values, including `twofactor` and `two_factor`.
- Stop masking symbolic `error.code` values such as `ENOENT` and `ECONNREFUSED`. Only 4–8 digit numeric codes are treated as 2FA codes, so the most diagnostic field of an error object is readable again.
- Require a whole-word 2FA label, so `decode`, `barcode`, and `encoded` no longer mask unrelated numbers.
- Stop partially masking a 9+ digit run, which previously left trailing digits visible and read as a full mask.
- Preserve useful `Error` diagnostics — `name`, `message`, `stack`, `cause`, `errors`, and own enumerable properties — while redacting secrets from them.

### Behavior changes

- Values that cannot be safely serialized now render as an explicit withheld marker rather than the original object or `String(value)`. This affects circular structures, revoked proxies, and objects with throwing getters.
- `BigInt` values render as `"123n"` instead of throwing during serialization.
- URLs are still preserved byte-for-byte, but userinfo and sensitive query/fragment parameters within them are now masked.

### Added

- Regression tests for redaction rules and failure paths (75 cases).
- CI on Node 22 and 24 with audit and pack validation, release-tag verification, npm provenance, and a private vulnerability-reporting policy.

### Documentation

- Replace "always shown" with "emitted regardless of the verbose preference" throughout, and state explicitly that Raycast disables console output for Store-installed extensions. Emitting is not the same as being visible.

## [1.2.4] - 2026-05-30

### Fixed API keys not being redacted by key name

- Key-based redaction now masks `key`, `apiKey`, `apikey`, `accessToken`, `apiToken`, and `bearer` fields, matching the documented behavior. Previously a value like `{ apiKey: "sk_live_123456" }` was logged in the clear because none of these key names were in the redaction list — only `password`/`pass`/`pwd`/`secret`/`token`/`auth`/`authorization` were.

## [1.2.3] - 2026-05-31

### Fixed prefix being redacted

- Redaction now applies only to the user-supplied message and args, never to the developer-authored prefix/timestamp/context. Previously a long camelCase prefix (e.g. `[ProductHuntFrontpage]`, 20+ chars) matched the base64-token heuristic and was masked to `[***]`. Credential redaction of the message/args is unchanged.


## [1.2.2] - 2026-01-13

### Fixed URL redaction bug

- Fixed overly aggressive URL redaction that was breaking legitimate URLs containing alphanumeric sequences


## [1.2.1] - 2026-01-05

### Fixed infinite recursion and email masking bugs

- Fixed infinite recursion bug in `inspect()` and `sanitizeArgs()` that caused redaction to silently fail for nested objects

## [1.2.0] - 2026-01-05

### Added new methods and improve email masking

- `info()` method for always-shown informational messages (blue color)
- `debug()` method for extra-verbose diagnostic output (gray color, verbose-only)
- `time()` method for performance profiling with duration logging
- `step()` method for LLM-friendly sequential step tracking
- `inspect()` method for formatted object inspection with clear delimiters
- `showTimestamp` config option for ISO timestamp prefixes
- `showContext` config option for file:line context (LLM-friendly debugging)
- `colorize` config option for ANSI color-coded output (enabled by default)
- Color-coded log levels: error (red), warn (yellow), info (blue), debug (gray), log (cyan)
- Bold labels for error, warn, info, and step markers
- Support for masking email addresses in `redactString` and `sanitizeArgs`

### Changed prefixes and added color support

- `error()` now displays `[ERROR]` label prefix
- `warn()` now displays `[WARN]` label prefix
- All log methods now support optional color output

### Fixed security bug in inspect method

- `inspect()` method now properly redacts sensitive data in objects

## [1.0.0] - 2025-10-18

### Added

- Initial release of @chrismessina/raycast-logger
- Automatic redaction of sensitive data (passwords, tokens, emails, 2FA codes)
- Preference-driven verbose logging support
- Singleton logger instance with `logger` export
- Custom Logger class for advanced configurations
- Child logger support with custom prefixes
- TypeScript support with full type definitions
- Utility functions: `redactString()` and `sanitizeArgs()`
- Comprehensive documentation and examples
