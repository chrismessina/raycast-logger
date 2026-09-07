# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.0] - 2026-09-06

Opt-in strict redaction, and the tarball stops shipping useless source maps.

### Added

- **Strict redaction level.** `enableRedaction` accepts `"standard"` (what `true`
  always meant) or `"strict"`, which additionally replaces every URL query string
  and fragment with a marker (`?***`, `#***`), independently, leaving userinfo and
  path intact. It exists for the value key-based rules cannot see — a secret under
  an unremarkable parameter name (`?sid=`, `?u=`) — and is off by default because
  the query is frequently the thing being diagnosed.
- **`strictRedaction` user preference.** Declared by the extension as a checkbox
  (README has the block to paste). When on, the effective level is strict for every
  logger in the extension, including children, and even over a configured
  `enableRedaction: false` — the user's privacy floor beats the author's setting.
  Read per call, so flipping it takes effect on the next log line. If the
  preference cannot be read the configured level applies, `false` included; that is
  a fallback, not fail-closed, and is documented as such.
- `redactString(input, options?)` and `sanitizeArgs(args, options?)` take an
  optional `{ level }`. `RedactionLevel` and `RedactionOptions` are exported.
- A packing test that asserts what the tarball contains.

### Changed

- **`LoggerConfig.enableRedaction` is now `boolean | "standard" | "strict"`.** Every
  existing constructor call compiles. A consumer that *reads*
  `config.enableRedaction` back into a `boolean` variable will not; no known
  extension does this.
- Source maps are no longer emitted or shipped. They carried no `sourcesContent`
  and pointed at `../src/*.ts`, which is not in the tarball, so they resolved to
  nothing — 26,795 of 106,786 unpacked bytes. `files` also excludes `dist/**/*.map`
  so a stale local build cannot pack them.
- `CHANGELOG.md` now ships. It never had, because npm only auto-includes README,
  LICENSE, and package.json.
- Function and symbol arguments now render as `[Function: …]` / `Symbol(…)`
  strings rather than being passed to the console as-is (see *Security*).
- The withheld marker is fixed text, `[unserializable value — withheld to avoid
  logging unredacted data]`, and no longer shows the value's type tag (see
  *Security*).
- Under strict, a `RegExp` whose source contains a URL with a query is rendered with
  the query masked; if that source also had an unescaped `/` inside a character
  class, it is re-escaped (`[/]` → `[\/]`). Semantics are unchanged. A `RegExp`
  with no URL keeps its exact representation.
- Under strict, two property names that differ only in their query collapse to one
  masked name; the later value wins.
- `redactByKey`'s doc comment no longer describes it as a `JSON.stringify` replacer.
- Standard mode is otherwise byte-identical to 1.4.0 for message strings and
  structured values — verified by diffing the compiled 1.4.0 source against this
  release over the full test corpus (878 strings, 2,400 structured values,
  0 differences).

### Fixed

- **Logging could throw.** A top-level function argument whose `name` getter throws
  propagated the exception out of `sanitizeArgs` and out of every logger method.
  Functions now go through the same guarded path as objects and render as the
  withheld marker.
- The default verbose check was stored as an unbound method reference and invoked
  through the config object, so `this` inside it was the config. Harmless until the
  method used instance state; now bound.
- Placeholder restoration in `redactString` rescanned the whole string once per
  URL; a 60KB string of URLs took ~95ms and now takes ~12ms.

### Security

- Top-level function and symbol arguments passed through `sanitizeArgs` untouched,
  so a credential in a function's `name` or a symbol's description printed
  verbatim. Both are now redacted like any other caller text.
- The withheld marker interpolated the value's `Symbol.toStringTag`, a getter the
  value controls, so an unserializable object could still print an arbitrary
  string. The marker now carries nothing from the value.

Reviewed adversarially across three rounds; each round's findings are pinned as
tests in `test/strict.test.mjs`.

## [1.4.0] - 2026-08-13

Raycast API 2.0 support, and a fix for redaction eating REST paths.

### Added

- Support `@raycast/api` 2.x. The peer range widens from `^1.0.0` to
  `^1.0.0 || ^2.0.0`; no code change was required, because the only API this
  package imports (`getPreferenceValues`) is unchanged in 2.0. Verified by
  building and running the full suite against `@raycast/api@2.0.5`.

### Changed

- Paths that 1.3.0 masked are now logged in full. That is the point of the fix,
  but it is a visible difference in existing logs.
- Roughly 1.7% of random standard-base64 secrets are kept when logged with **no**
  credential key, no `bearer` prefix, and not under a credential-named structured
  field — the cost of the path discriminator. Any credential context still masks
  them. Down from ~40-63% under a slash-only rule.

### Fixed

- Stop masking filesystem paths, REST paths, and Docker image names as base64.
  `/` was both a base64 body character and the "contains a non-letter" signal in
  the encoded-secret heuristic, so any unbroken `[A-Za-z0-9+/]` run of at least
  20 characters and divisible by four became `***`. Whether a path was masked
  depended on its length mod 4, which is why it looked arbitrary:
  `/api/v1/tailwindlabs/tailwindcss.com` logged as `***.com`,
  `getmeili/meilisearch:v1.41.0` as `***:v1.41.0`, and a Docker compose path as
  `***-app/docker-compose.yml`.

  The heuristic now skips candidates that look like a *path* — a leading `/`, or
  a slash-delimited segment of four or more all-lowercase letters — rather than
  skipping every candidate containing a slash. Skipping on the slash alone was
  the obvious fix and was wrong: standard-alphabet base64 contains a literal `/`
  roughly 40% of the time (63% at PEM line length), which silently unmasked AWS
  secret access keys, `Authorization: Basic <base64>` values, and PEM bodies.

## [1.3.0] - 2026-08-03

Redaction hardening and the first regression suite. No API was added or removed;
existing imports and call sites are unchanged. This is a minor rather than a
patch release because several fail-open paths now fail closed, which changes
what is printed for hostile or unserializable values — see *Changed*.

### Added

- Regression tests for redaction rules and failure paths (110 cases), including one per confirmed leak found across four rounds of adversarial review, verified by mutation testing.
- CI on Node 22 and 24 with audit and pack validation, release-tag verification, npm provenance, and a private vulnerability-reporting policy.

### Changed

- Values that cannot be safely serialized now render as an explicit withheld marker rather than the original object or `String(value)`. This affects revoked proxies and objects with throwing getters.
- **Circular references render as `[Circular]` with sibling fields preserved**, instead of withholding the entire object. v1.2.4 returned the original unredacted object; the withheld-whole-object behavior was an interim fix.
- **A custom `toJSON()` is no longer called.** Objects relying on it to shape their log output now render their own enumerable properties instead. `Date`, `RegExp`, and `URL` are handled explicitly so they keep their meaning; `Map` and `Set` continue to render as `{}`.
- **`myApiKey` and `MY_API_KEY` are now masked.** v1.2.4 documented compound keys as never matching; `apiKey` wearing a prefix is still an API key. Keys whose head noun is bare `key` (`cacheKey`, `sortKey`, `publicKey`) or `value` (`apiKeyValue`) remain readable.
- Traversal is bounded: depth 12, 200 object entries, 500 array entries, each with an explicit truncation marker.
- `BigInt` values render as `"123n"` instead of throwing during serialization.
- URLs are still preserved byte-for-byte, but userinfo and sensitive query/fragment parameters within them are now masked.
- Replace "always shown" with "emitted regardless of the verbose preference" throughout, and state explicitly that Raycast disables console output for Store-installed extensions. Emitting is not the same as being visible.

### Fixed

- Preserve `:` versus `=` and surrounding formatting in structured log lines.
- Avoid treating long decimal IDs and ordinary alphabetic words as base64 secrets.
- Treat snake_case, kebab-case, camelCase, and space-separated credential keys consistently, including `apple_password`.
- Apply the same 2FA key set to numeric and string values, including `twofactor` and `two_factor`.
- Stop masking symbolic `error.code` values such as `ENOENT` and `ECONNREFUSED`. Only 4–8 digit numeric codes are treated as 2FA codes, so the most diagnostic field of an error object is readable again.
- Require a whole-word 2FA label, so `decode`, `barcode`, and `encoded` no longer mask unrelated numbers.
- Recognize the underscore spelling `two_factor:` in messages, matching the already-supported `two-factor` and `two factor` forms.
- Decide message-level redaction with the same `isCredentialKey` rule the structured path uses, instead of a parallel hardcoded alternation. The two disagreed in both directions: `tokenValue=x` and `authorizationHeader=x` masked as object keys but leaked in messages, while `cache_key=x` masked in messages but stayed readable as an object key. This also removes the prefix-count boundary entirely — 7 segments leaked at the first bound, 13 at the second.
- Recurse into non-credential assignment values. `Error: token=secret` matched label `Error`, whose value swallowed the nested credential — the exact shape of a stack trace's first line, so thrown errors leaked.
- Split acronym boundaries when segmenting keys, so `DBPassword`, `NPMToken`, and `HTTPAuthorizationHeader` are recognized rather than treated as single words.
- Decode nested URL parameters up to 8 rounds and scan every intermediate form, and continue past a malformed escape instead of abandoning inspection. A 4-layer encoded value and a single stray `%ZZ` each defeated the previous logic.
- Match the message-level key with an atomic group (`(?=(X))\\N`) so the engine cannot backtrack into shorter identifiers, and cap the capture at 512 characters. A long delimiter chain (`"a-".repeat(30000)`) backtracked for ~2.5s originally and ~4.7s after the matcher was made permissive; it now completes in ~55ms. The cap exists for the failure case — an uncapped atomic capture costs O(n) at every starting position and took ~1.0s on the same input.
- Raise the assignment-recursion depth from 4 to 24. A chain of innocuous labels (`a=b=c=d=e=token=SECRET`) exhausted the budget before reaching the credential.
- Classify all-uppercase concatenated keys (`DBPASSWORD`, `NPMTOKEN`) by suffix when they cannot be segmented. The fallback uses only unambiguous terms, so `monkey`, `bypass`, and `compass` stay readable.
- Treat `+` as a key separator, so a parameter named `access+token` (or a decoded `%2B`) is segmented rather than read as one unrecognized word.
- Raise the nested-URL decode cap from 8 to 32 rounds. Limits of 3 and then 8 were each defeated by adding one more encoding layer; the loop already exits when decoding stops changing the string, so the cap only bounds pathological input.
- Stop partially masking a 9+ digit run, which previously left trailing digits visible and read as a full mask.
- Preserve useful `Error` diagnostics — `name`, `message`, `stack`, `cause`, `errors`, and own enumerable properties — while redacting secrets from them.

### Security

- Redact credentials embedded in URL userinfo and sensitive query parameters while preserving benign URLs.
- Fail closed when sanitizing circular or otherwise unserializable values instead of returning the original object. Previously `sanitizeArgs` and `redactValueByKey` returned the **unredacted original** when `JSON.stringify` threw, so a cyclic object containing a secret was logged in full.
- Redact credential-keyed values regardless of their runtime type. A credential key holding a number, boolean, or nested object is now masked; previously only string values were.
- Redact the `inspect()` label, the configured `prefix`, and the `step()` identifier. All three reach the console outside the message pipeline, so an interpolated value (`[Account ${email}]`) printed verbatim beside a masked message.
- Walk objects directly instead of serializing through `JSON.stringify`. A custom `toJSON()` runs *before* the redacting replacer, so a value could move a credential onto an innocent key (`{ password, toJSON() { return { note: this.password } } }`) and defeat key-based redaction entirely. The same mechanism let an `Error` subclass with `toJSON` bypass Error flattening, and made the old BigInt retry serialize a second, different `toJSON()` snapshot. `toJSON` is now never invoked.
- Mask compound credential keys by head noun, so environment-style names (`NPM_TOKEN`, `GITHUB_TOKEN`, `DB_PASSWORD`, `DB_PASS`, `DB_AUTH`, `MY_API_KEY`) are redacted as keys and in messages. Previously only exact matches were. An unambiguous credential word anywhere in the key (`authorizationHeader`) also qualifies.
- Apply the credential-key guard before type dispatch, so a credential key holding a `BigInt`, `Symbol`, or named function is masked. Previously only string, number, and boolean values were — the other types converted themselves to text and returned first.
- Read `Date`, `RegExp`, and `URL` through intrinsic prototype methods. A `Date` subclass overriding `toISOString`, an own `toString`, or an own `href` getter could otherwise return an arbitrary attacker-chosen string that bypassed redaction entirely.
- Mask percent-encoded nested URLs (`?redirect=https%3A%2F%2Fidp%2Fcb%3Faccess_token%3D…`), whose escaped delimiters hid the embedded query from the parameter scan.
- Create walked properties with `Object.defineProperty`, so a payload carrying a `__proto__` key can no longer reparent the returned object.
- Bound `Error` own-property enumeration to the same 200-entry limit as any other object.
- Treat `?` and `;` as URL parameter separators, so a credential in a nested URL (`?redirect=https://idp/cb?access_token=...`) or after a semicolon can no longer hide inside the outer parameter's value.
- Sanitize the logger's own internal error reporting, which previously passed a raw caught error to `console.error`.
- Contain a throwing `isVerboseEnabled` callback instead of letting it propagate into caller code.

## [1.2.4] - 2026-05-30

### Fixed

- Key-based redaction now masks `key`, `apiKey`, `apikey`, `accessToken`, `apiToken`, and `bearer` fields, matching the documented behavior. Previously a value like `{ apiKey: "sk_live_123456" }` was logged in the clear because none of these key names were in the redaction list — only `password`/`pass`/`pwd`/`secret`/`token`/`auth`/`authorization` were.

## [1.2.3] - 2026-05-30

### Fixed

- Redaction now applies only to the user-supplied message and args, never to the developer-authored prefix/timestamp/context. Previously a long camelCase prefix (e.g. `[ProductHuntFrontpage]`, 20+ chars) matched the base64-token heuristic and was masked to `[***]`. Credential redaction of the message/args is unchanged.

## [1.2.2] - 2026-01-13

### Fixed

- Fixed overly aggressive URL redaction that was breaking legitimate URLs containing alphanumeric sequences

## [1.2.1] - 2026-01-05

### Fixed

- Fixed infinite recursion bug in `inspect()` and `sanitizeArgs()` that caused redaction to silently fail for nested objects

## [1.2.0] - 2026-01-05

### Added

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

### Changed

- `error()` now displays `[ERROR]` label prefix
- `warn()` now displays `[WARN]` label prefix
- All log methods now support optional color output

### Security

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

[Unreleased]: https://github.com/chrismessina/raycast-logger/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/chrismessina/raycast-logger/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/chrismessina/raycast-logger/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/chrismessina/raycast-logger/compare/v1.2.4...v1.3.0
[1.2.4]: https://github.com/chrismessina/raycast-logger/compare/1.2.2...v1.2.4
[1.2.3]: https://github.com/chrismessina/raycast-logger/commit/db9f298
[1.2.2]: https://github.com/chrismessina/raycast-logger/releases/tag/1.2.2
[1.2.1]: https://www.npmjs.com/package/@chrismessina/raycast-logger/v/1.2.1
[1.2.0]: https://www.npmjs.com/package/@chrismessina/raycast-logger/v/1.2.0
[1.0.0]: https://www.npmjs.com/package/@chrismessina/raycast-logger/v/1.0.0
