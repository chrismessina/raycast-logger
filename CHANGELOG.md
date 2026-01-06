# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
