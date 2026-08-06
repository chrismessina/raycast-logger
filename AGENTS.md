# AGENTS.md

Guidance for AI coding agents working in this repository. Written to the
[agents.md](https://agents.md) convention, so it applies to any agent
(Claude Code, Warp, Cursor, Codex, …) rather than a single tool.

## What this package is

`@chrismessina/raycast-logger` is a zero-dependency logging utility for Raycast
extensions whose defining feature is **automatic redaction of secrets**. Treat
it as a security boundary, not a convenience wrapper: a change that lets a
credential reach the console is a vulnerability, not a bug.

Consumers are published Raycast extensions. The public API is deliberately tiny
and must stay source-compatible.

## Commands

Package manager is **npm** (there is a `package-lock.json`).

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Build | `npm run build` |
| Test | `npm test` (builds first, then `node --test test/*.test.mjs`) |
| Type-check only | `npm run typecheck` |
| Watch | `npm run watch` |
| Inspect the tarball | `npm pack --dry-run` |
| Clean | `npm run clean` |

**Before reporting any change as done, all of these must pass:**

```bash
npm test && npm run typecheck && npm audit --audit-level=high && npm pack --dry-run
```

Tests run against the **compiled output in `dist/`**, not the TypeScript source.
`npm test` rebuilds first, so a stale `dist/` cannot produce a false pass — but
if you invoke `node --test` directly, build first or you are testing old code.

## Releasing

**Do not run `npm publish` locally.** Publication happens in CI:

1. Land changes on `main`. CI runs on push to `main` — Node 22 and 24, plus
   audit and pack validation.
2. Bump `version` in `package.json` and update `CHANGELOG.md`.
3. Create a signed tag `vX.Y.Z` **matching the package version exactly**; the
   workflow hard-fails if `tag != v$VERSION`.
4. Publish a GitHub release for that tag. That triggers
   `.github/workflows/publish.yml`, which publishes with npm provenance.
   Prereleases go to the `next` dist-tag automatically.

Commits are SSH-signed via the 1Password agent. If signing fails, leave the work
staged and say so rather than bypassing it.

## Architecture

Three modules, all under `src/`.

### `src/redaction.ts` — the security core

Public: `redactString(input)` and `sanitizeArgs(args)`, plus `redactByKey` /
`redactValueByKey` used internally.

**One policy function decides everything.** `isCredentialKey(key)` is consulted
by *both* the message-level rules and the structured walker. This is
load-bearing: earlier versions had a hardcoded regex alternation for messages
and a separate key set for objects, and the two disagreed in both directions —
`tokenValue=x` leaked in messages while masking as an object key, and
`cache_key=x` did the reverse. **If you add a matching rule, add it to
`isCredentialKey`, never to a call site.**

Three term sets, each with a different scope:

| Set | Scope | Contents |
| --- | --- | --- |
| `CREDENTIAL_KEYS` | exact whole-key match, after `normalizeKey` | includes overloaded words (`key`, `code`, `auth`) that are safe only as a complete key |
| `CREDENTIAL_ANYWHERE` | any segment of a compound key | unambiguous terms only (`token`, `secret`, `password`, `apikey`, `authorization`, …) |
| `CREDENTIAL_HEAD_ONLY` | head noun position only | `pass`, `pwd`, `auth` |

`isCredentialKey` applies them in this order:

1. Exact match against `CREDENTIAL_KEYS`.
2. If the key cannot be segmented at all (`DBPASSWORD`, `NPMTOKEN` — no
   delimiter, no case transition), a **suffix** test against
   `CREDENTIAL_ANYWHERE` only.
3. Head noun — final segment, or final two joined — against
   `CREDENTIAL_HEAD_ONLY`, then `CREDENTIAL_ANYWHERE`. `NPM_TOKEN` and
   `MY_API_KEY` mask; `apiKeyValue` does not.
4. Any segment against `CREDENTIAL_ANYWHERE`. Covers `authorizationHeader`,
   whose head noun is a container rather than the secret.

`key` and `code` appear **only** in `CREDENTIAL_KEYS`, so `cacheKey`,
`sortKey`, `publicKey`, `statusCode`, and `error.code` stay readable while bare
`key` and `code` still mask. `pass`/`pwd`/`auth` are head-only, so `DB_PASS`
masks while `passThrough` and `authFlow` do not. Masking those would destroy the
exact diagnostics this package exists to preserve.

**Objects are walked directly — `JSON.stringify` is NOT used for traversal.**
This is not a style preference. `JSON.stringify` invokes `toJSON()` *before* the
replacer, so a value could relocate a credential onto an innocent key and defeat
key-based redaction entirely. `safeTree()` never calls `toJSON`. `Date`,
`RegExp`, and `URL` are read through **intrinsic prototype methods**, so a
subclass override cannot substitute an arbitrary string.

Traversal is bounded — `MAX_DEPTH` 12, `MAX_OBJECT_ENTRIES` 200,
`MAX_ARRAY_ENTRIES` 500 — with explicit truncation markers. Cycles render as
`[Circular]` with sibling fields preserved.

### `src/logger.ts` — Logger class and singleton

- `Logger` class plus a lazily-created `logger` singleton via `getInstance()`.
- Verbosity-gated: `log`, `debug`, `step`, `inspect`, timer completion.
- Emitted regardless of the preference: `error`, `warn`, `info`.
- `child(prefix)` composes prefixes for namespacing.
- `LoggerConfig` customizes the verbosity check, prefix, redaction, timestamps,
  caller context, and colorization.

**Every caller-supplied string that reaches the console must be redacted**, not
only the message. The `prefix`, the `step()` identifier, and the `inspect()`
label bypass `processLogData` and go through `safeText()` instead. An
interpolated prefix (`[Account ${email}]`) printing verbatim beside a masked
message is a real leak that shipped once.

### `src/index.ts` — public API

Re-exports `Logger`, `logger`, `LoggerConfig`, `LoggerPreferences`,
`redactString`, `sanitizeArgs`. Keep this surface minimal; every addition is a
compatibility commitment to published extensions.

## Working rules

- **No `any`.** `tsconfig.json` is `strict`, and the Raycast Store lint rejects
  `any` in consuming extensions.
- **Never widen redaction without checking the false-positive side.** Masking a
  non-secret loses a diagnostic; missing a secret leaks it. Both are failures.
  Any change to key matching needs cases proving what still stays readable.
- **Fail closed.** If a value cannot be safely serialized, emit a withheld
  marker — never the original object. `sanitizeArgs` returning its input on
  failure was a live vulnerability in v1.2.4.
- **Be suspicious of fixed bounds as security controls.** Four review rounds
  found the same shape repeatedly: a limit (prefix count, decode rounds,
  recursion depth, label length) that an attacker steps over by adding one more
  of something. Bounds are right for *resource exhaustion* and wrong for
  *classification*. Prefer removing the mechanism — the message matcher uses an
  atomic group rather than a length cap for exactly this reason.
- **Module-scope regexes must only be used with `String.replace()`,** which
  resets `lastIndex`. Calling `.test()` / `.exec()` / `.matchAll()` on a
  `g`-flagged shared regex makes redaction nondeterministic.

## Testing expectations

`test/redaction.test.mjs` and `test/logger.test.mjs` (110 cases) import the
compiled leaf modules. `redaction.test.mjs` imports `dist/redaction.js`
directly rather than the barrel, because `index.js` pulls in `logger.js`, which
requires `@raycast/api` — a package with no loadable runtime outside Raycast.
`logger.test.mjs` stubs that module via `Module._load`.

Every test needs **both** directions: a case that masks and a near-miss that
does not. Absence of a secret is not sufficient — a mutation that withholds
everything, or suppresses output entirely, satisfies an absence-only assertion
while destroying the feature.

**Verify a new test by breaking the code it covers** and confirming it fails.
Confirm the edit actually landed (a `grep` count) before trusting a green run:
a probe that silently matched nothing looks identical to a passing test.

## Constraints

- `@raycast/api ^1.0.0` is a **peer** dependency; consumers provide it. It has
  no loadable Node runtime outside Raycast, so anything importing it must be
  stubbed in tests.
- Output is CommonJS (`target: ES2020`), entry `dist/index.js`, types
  `dist/index.d.ts`.
- The `files` allowlist in `package.json` is what keeps private material out of
  the published tarball.

## Local testing in a consuming extension

```bash
# In this package
npm run build && npm link

# In the consuming extension
npm link @chrismessina/raycast-logger
ray dev                 # then enable "Verbose Logging" in preferences
```

Unlink with `npm unlink @chrismessina/raycast-logger` in the extension and
`npm unlink` here.

## Documentation map

| File | Purpose |
| --- | --- |
| `README.md` | Full API reference, redaction rules, examples |
| `QUICKSTART.md` | Three-step setup for a consuming extension |
| `CHANGELOG.md` | Version history — security entries state the *mechanism* |
| `SECURITY.md` | Private vulnerability reporting |
| `docs/solutions/` | Documented solutions to past problems, by category with YAML frontmatter (`module`, `tags`, `problem_type`) — relevant when implementing or debugging in a documented area |
| `CONCEPTS.md` | Shared domain vocabulary (redaction, credential key, emitted vs visible) |

When behavior changes, update `README.md` **and** `CHANGELOG.md` in the same
change. The README's redaction tables make specific, checkable claims about
which keys mask — verify them against the code rather than assuming.
