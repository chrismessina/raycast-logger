# raycast-logger — TODO

Working task list. The **authoritative design** lives in
`.github/.private/docs/v2-proposal.md` (rev 3); the **session handoff** in
`.github/.private/docs/HANDOFF-2.0.md`. This file is the checklist those two feed —
when it disagrees with the proposal, the proposal wins and this file needs updating.

---

# Now: 1.5.0 — strict redaction (branch `release/1.5`)

**Decided 2026-09-06 (Chris, option B):** 1.5.0 ships *before* 2.0, on its own branch.
The strict-redaction change is additive for **constructor inputs** — every existing
`new Logger({ enableRedaction: true })` and `false` keeps compiling, which is what the v2
compatibility contract promises — so the field becomes `boolean | "standard" | "strict"`
and earns no major. One narrow break is accepted: a consumer that reads
`config.enableRedaction` *back out* of a `LoggerConfig` into a `boolean` variable stops
compiling. No fleet extension does that (they only construct), and it goes in the
changelog. Landing 1.5 separately keeps a redaction-policy change out of the same release
as the emission-pipeline rewrite; a leak in `2.0.0-next.1` would otherwise have two
suspects. The original argument is in the Deferred section below ("Strict redaction as
a user preference"), now promoted; where that section's sketch disagrees with this one,
this one wins.

Branches: `release/1.5` for everything in this section, `release/2.0` for Phase 1. Both cut
from `main` at `9bf1488`. 1.5 merges to `main` first; 2.0 rebases onto it and designs
`ResolvedLoggerConfig` with a resolved redaction level from the start.

## Strict redaction — design decisions (settled, build to these)

1. **Two rules, ship one.** Strict = mask URL **query and fragment**. Same intent as
   digger's `redactUrlForLog` (`raycast-digger/src/utils/urlUtils.ts:146-153`, origin +
   pathname), but not the same output: the logger keeps the caller's original formatting
   and userinfo masking (`src/redaction.ts:339-340`), never re-serializes through `URL`,
   and leaves a marker. Masking "long opaque path segments" is a *classification
   bound* — the trap four Codex rounds and the 1.4.0 karakeep bug taught — and does
   **not** ship in 1.5. If it ever does, it is a separate line item with a stated
   discriminator and both-direction tests.
2. **Marker, not silence — exact outputs.** Query and fragment are masked
   *independently*, each to a single marker, and the fragment is whatever follows the
   first `#` even if it contains `?`:
   | input | strict output |
   | --- | --- |
   | `https://h/p?a=1&sid=x` | `https://h/p?***` |
   | `https://h/p#sec` | `https://h/p#***` |
   | `https://h/p?a=1#sec` | `https://h/p?***#***` |
   | `https://h/p?` (empty query) | `https://h/p?***` |
   | `https://h/p?next=https://i/cb?t=1` | `https://h/p?***` (the nested URL is query content and goes with it) |
   | `https://u:s@h/p?q=1` | `https://***:***@h/p?***` |
   | `https://h/p;token=x` | `https://h/p;token=***` (standard already masks this — strict is a **superset** of standard, so standard runs first and strict only replaces the query/fragment runs) |
   The URL run itself is whatever the existing extractor matched
   (`/https?:\/\/[^\s"'<>\])}]+/gi`, `src/redaction.ts:466`). Its known boundaries are
   inherited, not fixed here: an IPv6 host (`https://[::1]/p?sid=x`) is not recognized
   as a URL at all, and a `)` inside a query ends the run early. Both are pre-existing
   standard-mode limits; pin them with tests that document current output so a later
   change is deliberate.
3. **Preference is declared per extension.** Raycast reads preferences from the
   extension manifest; the package cannot inject one. README ships a paste-in block
   (`strictRedaction`, checkbox, default `false`), and the `develop` house style gains a
   line for it. This closes the "manifest or package?" open question.
4. **Precedence is one rule, resolved once per call.** Effective level = `"strict"` when
   the user preference is on, otherwise the configured value (`false` | `"standard"` |
   `"strict"`; `true` ≡ `"standard"`). The preference wins even over a configured
   `false` — the user's privacy control beats the author's convenience. Children inherit
   the configured value through `child()`'s spread (`src/logger.ts:463`) and read the
   preference themselves, so a preference flipped mid-session takes effect on the next
   call of every logger; there is no per-child opt-out. If `getPreferenceValues` throws,
   the level **falls back to the configured value** — which can be `false`, so this is
   *not* fail-closed and must be stated as such in the README. Read the preference the
   same way `verboseLogging` is read. The two verbosity-failure diagnostics differ on
   purpose: when the *preference read* fails (`defaultVerboseCheck`) the diagnostic uses
   the configured level, because the preference is what just failed; when the *author's
   custom callback* fails (`isVerboseEnabled`) the preference is still readable, so the
   effective level applies. Codex round 1 caught the second case.
5. **Thread it, never store it — the full chain.** `redactString(input, options?)` and
   `sanitizeArgs(args, options?)` gain `{ level: "standard" | "strict" }` (2.0 extends the
   same object with `additionalSensitiveKeys`). **No module-level mode flag** — two
   loggers in one extension would fight. The option must reach every place a string can
   be emitted, and the current code has more of them than the three obvious ones:
   - `sanitizeArgs` → `redactedClone` → `safeTree` (recursive) → `redactByKey`
     (`src/redaction.ts:663`) → `redactString`. **`redactByKey`'s identifier branch
     returns `maskEmail(value)` only** (`src/redaction.ts:547-548`), so today
     `{ user: "https://h/p?sid=x" }` never sees URL redaction. Under strict that branch
     must also run the URL pass; under standard it stays byte-identical.
   - `errorToTree` calls `redactString` directly for `name`, `message`, `stack`
     (`src/redaction.ts:595-598`) and recurses for `cause`/`errors`.
   - the `RegExp` and `URL` built-in branches (`src/redaction.ts:691-694`).
   - Logger sites: `safeText` (prefix, `step` id, `inspect` label), `processLogData`,
     `inspect` (its own `catch` has no known trigger under redaction — the guarded
     clone converts every throw to the marker before `JSON.stringify` runs; it is
     reachable only with `enableRedaction: false` on a cyclic value), and the two
     verbosity-failure diagnostics above. Line numbers deliberately omitted — grep the function names.
   - Found by Codex rounds 1–2, all now fixed and pinned in `test/strict.test.mjs`:
     top-level functions/symbols returned raw by `sanitizeArgs`; `RegExp` sources hide
     URLs behind `\/`; the withheld marker interpolated a hostile `Symbol.toStringTag`
     (now fixed text, `WITHHELD`); property *names* that are URLs; a throwing function
     `name` getter escaping as an exception.

`safe()` composition is moot until `safe()` exists. Record only: strict must not
preclude a per-value override later.

## 1.5.0 checklist

- [ ] **Witnessed red first — paste the raw failing output before touching `src/`.**
      Every test asserts a **positive** half (the marker is present, or a diagnostic
      sibling survived) as well as the absence; do not treat the existing suite as
      preservation coverage — it has absence-only cases (`test/redaction.test.mjs:78`,
      `:500-501`, `:577`, `:589`, `:635` among others). Exact-output tests for:
      - every row of the table in decision 2, as a message string, as `{ url }` in args,
        as a `URL` instance in args, inside an `Error` message and `stack`, and under
        an identifier key (`{ user: … }`, `{ email: … }`);
      - the IPv6 and `)` boundary cases, pinning current output;
      - standard mode byte-identical to 1.4.0 on every fixture above (run the same
        fixtures with `level: "standard"` and diff against 1.4.0 output captured once);
      - `true` ≡ `"standard"`, `false` still returns raw args;
      - preference `true` overrides configured `"standard"` **and** configured `false`,
        across message, args, prefix, `step`, `inspect`, and the inspect fallback;
      - preference read failure falls back to the configured value, including `false`;
      - a child created before the preference flips observes the flip on its next call;
      - two `Logger` instances at different levels in one process do not leak into each
        other (interleaved calls);
      - input objects are not mutated.
- [ ] `LoggerConfig.enableRedaction: boolean | "standard" | "strict"`;
      `LoggerPreferences.strictRedaction?: boolean`. Note the read-back caveat in the
      changelog.
- [ ] Options argument on `redactString` / `sanitizeArgs`, threaded through the full
      chain in decision 5.
- [ ] `redactUrl` strict branch per decision 2: run standard first, then replace the
      query run and the fragment run with their markers.
- [ ] Logger: resolve the effective level once per call and pass that one value to
      every site in decision 5.
- [ ] `redactByKey` docstring at `src/redaction.ts:515-516` and `:562` — delete the
      "safe to use as JSON.stringify replacer" sentences. Three sessions flagged it.
- [ ] Drop source maps from the tarball. `files` is `["dist", "SECURITY.md"]`
      (`package.json:9-12`) with no `.map` entry to remove, so the mechanism is: set
      `sourceMap` and `declarationMap` to `false` in `tsconfig.json:7-8`, and add
      `"!dist/**/*.map"` to `files` so a stale local build cannot pack them either. Size
      basis, unpacked: 26,795 of 106,786 bytes (≈25%); the 32,828 figure is the
      *compressed* tarball and must not be compared against it.
- [ ] **New** packing test (none exists — `test/*.mjs` never inspects package
      contents; CI only runs `npm pack --dry-run`): `npm pack --json` and assert no
      `.map`, nothing under `.github/`, and that `dist/index.js` + `dist/index.d.ts` are
      present.
- [ ] README: config table row, preference paste-in block, a strict-mode section with
      the table from decision 2, the fallback-is-not-fail-closed note, and the digger
      rationale in two sentences (local; the control belongs at the moment of sharing).
- [ ] CHANGELOG 1.5.0. Codex review with the claimed-closed list. Then the release
      mechanics in `AGENTS.md`.
- [ ] **Fleet rollout to 1.5 — hold lifted (option B).** Once 1.5.0 is on npm, bump the
      seven below `^1.4` using the per-repo procedure in the rollout section below.
      `digger` additionally declares the preference. Whether digger then deletes
      `redactUrlForLog` is **digger's decision, not made here**: with the preference off
      by default, deleting it re-exposes query strings at its 14 warn/error sites, which
      is exactly what its own `AGENTS.md:149-157` argues is usually the right trade but
      still a change in default behavior.
- [ ] Update `dep-gates.md` floor to `^1.5` when published.

---
# Next: the 2.x series (branch `release/2.0`)

2.0.0 is **Phase 1 alone — the record/transport foundation.** Phase 2 (the bounded
walker) already shipped in 1.3.0, so the major bump rests on transports replacing
direct `console` calls as the emission path, not on the normalizer.

## Settle these three before writing Phase 1 code

All three are stated in the proposal but not resolved, and each bites at
implementation time rather than design time.

- [ ] **Does `enableRedaction: false` let raw records reach a custom transport?**
      The proposal calls the sanitized-before-transport boundary "non-negotiable"
      (`v2-proposal.md:130`) while also preserving the `enableRedaction` opt-out.
      Both cannot hold for a third-party transport. Decide which wins, and write it
      into the transport contract before any transport code exists.
- [ ] **Audit deep `dist/*` imports before adding the `exports` map.** An `exports`
      map silently breaks anyone importing `dist/*` directly. Evidence first
      (proposal §Phase 0 item 4 and §Packaging — grep for `deep imports`, the line numbers rot), then the decision.
- [ ] **Decide how `transport` replacing the console transport is communicated.**
      Supplying `transport` *replaces* console output (`v2-proposal.md:200`) — the
      single most user-visible migration hazard. A consumer adding one transport
      silently loses all console output. The migration guide leads with
      `createConsoleTransport()`.

## Phase 0 — prerequisites

- [ ] Determine the `@raycast/api` floor for `captureException` **and, separately**,
      for every environment field used by `includeRaycastContext`. Record both
      numbers in the proposal. This is a changelog lookup.
- [ ] From those two numbers, decide whether Phase 4 is one release or two. If the
      floors differ materially they cannot share a peer range, and that is a
      structural decision about the phase boundaries — not a detail inside a phase.
- [x] ~~Ship the "always shown" → "emits regardless of verbosity" correction.~~
      Shipped in 1.3.0 across README, JSDoc, and QUICKSTART, with the
      Store-suppression caveat.
- [ ] Audit consumers and repo history for deep `dist/*` imports (same as above).
- [ ] Decide the supported **Node and TypeScript** floors, after confirming Raycast's
      current runtime and bundler requirements. `@raycast/api` 2.x declares
      `engines: node >=22.22.2`; this package declares no `engines` at all, and CI
      runs 22 and 24.

## 2.0.0 — Phase 1: record and transport foundation

- [ ] Add `LogLevel`, `LogRecord`, `LoggerTransport`, and `ConsoleTransport` in
      focused modules; define and test the sanitized `LogRecord` contract.
- [ ] Introduce `ResolvedLoggerConfig`; retire `Required<LoggerConfig>` as the
      internal shape (it forces a default for every new optional field).
- [ ] Replace the spread-based `child()` construction with an explicit child
      constructor — a spread would share the parent's transport array *and* context
      object by reference, silently breaking the snapshot guarantee.
- [ ] Route every existing logger method through one private record-construction
      method.
- [ ] Apply verbose gating **before** record creation.
- [ ] Snapshot and merge context, then normalize and redact, **before** transport
      dispatch. Context is caller-supplied and untrusted on the same terms as args.
- [ ] Freeze records and nested context handed to transports.
- [ ] Reproduce existing console output **exactly** under default configuration —
      golden tests, including a class instance with a getter and a `toJSON`.
- [ ] Add the memory transport and the `./testing` subpath.
- [ ] Add extension-specific sensitive-key rules (`additionalSensitiveKeys`) as
      **additive-only** rules — built-in defaults must not be removable. Add them to
      `isCredentialKey`, never to a call site, or the message and structured paths
      diverge again. Note the proposal's "string vs `RegExp` coverage split" caveat
      is obsolete: `a629fae` made both paths defer to the one policy function, so
      both matcher types now cover both paths.
- [ ] Add package `exports`, declaration tests, and packed-consumer tests.
- [ ] Resolve the published source-map question (see below).
- [ ] Write the migration guide, leading with `createConsoleTransport()`.
- [ ] Dogfood prereleases (`next` dist-tag) in representative extensions.
- [ ] Publish 2.0.0 with migration, security, and compatibility notes.

Already done, carried from the proposal's checklist so it is not re-planned:

- [x] ~~Replace JSON round-tripping with bounded, side-effect-resistant
      normalization.~~ (1.3.0)
- [x] ~~Pin the `toJSON` change with a test.~~ (1.3.0 — invocation counter at
      `test/redaction.test.mjs:763`. Getters are intentionally still invoked, so
      there is no getter change to pin.)

## 2.1.0 — Phase 3: ergonomics

- [ ] Lazy logging and inspection methods.
- [ ] Inherited context via `child(prefix, context)` and `withContext`.
- [ ] Operation spans; implement `time` on the shared timing primitive.

## 2.2.0 — Phase 4: Raycast integration

- [ ] Raise the peer floor to whatever Phase 0 determined.
- [ ] Lazy, injectable Raycast environment context.
- [ ] Explicit sanitized `captureException`.

## Loose ends

- [x] ~~Published source maps.~~ Moved to the 1.5.0 checklist (2026-09-06).
- [x] ~~`redactByKey`'s docstring is a trap.~~ Moved to the 1.5.0 checklist (2026-09-06).
- [ ] **`.github/.private/` is gitignored but the `files` allowlist is what keeps it
      out of the tarball.** A packing test asserts its absence; keep that test.

---

# Deferred — not in 2.0 scope

## Opt-out for known-safe output (added 2026-08-11)

**Raised by:** Chris, 2026-08-11, off the back of the over-redaction above

### The argument

Redaction is a heuristic, and heuristics have two failure modes: they miss
credentials (the 1.3.0 bug) and they eat safe data (the bug above). Tightening
the pattern trades one for the other and never reaches perfect. At the call site,
though, the author often **knows** the value is safe — a REST path built from a
resource ID, a duration, a status code — and there is currently no way to say so.
The only lever is turning logging off, which is worse than an unreadable log.

So: give the caller an explicit escape hatch for output they know is safe, and
stop trying to win the heuristic on its own.

### Design constraints

The danger is obvious — an escape hatch used by default re-opens the leak the
redaction exists to close. So it must be:

- **Opt-in per call, never per logger.** A `logger.child({ redact: false })` would
  be set once and inherited by call sites the author never looked at. Prefer a
  per-call marker.
- **Narrow, not wide.** Mark the one safe *value*, not the whole log line — the
  line's other arguments should stay redacted.
- **Visible in review.** The call site should read as an assertion the author is
  making, so a reviewer can see and challenge it.

### Sketch (not authoritative — pick what fits the existing API)

```js
import { safe } from "@chrismessina/raycast-logger";

// Only the marked value bypasses redaction; `error` is still sanitized.
log.log(`${method} ${safe(path)}`, { error });
```

A `safe()` wrapper keeps the assertion local and greppable — auditing "where do
we bypass redaction" is one search. A boolean option on the log call would be
easier to add and harder to audit.

### Open question

Whether this is needed **in addition to** narrowing the path heuristic, or
**instead of** it. Fixing the path rule removes the immediate pain and the
karakeep case with it; `safe()` is the general answer for the next false positive,
which there will be. Chris's read is that perfect filtering is unreachable, so the
opt-out earns its place regardless — but the path fix should land first, since it
fixes existing consumers without requiring any of them to change code.

---

---

**Status (2026-08-30):** still deferred. The 1.4.0 path fix removed the immediate
pain without requiring any consumer to change code, which was the proposal's own
argument for landing it first. Revisit if false positives recur — the base64
heuristic still keeps ~1.7% of bare slash-bearing secrets, and that is the class
`safe()` would let a caller assert around.

---

## Strict redaction as a user preference (added 2026-09-05) — PROMOTED to 1.5.0

**Status (2026-09-06):** no longer deferred. Scheduled as 1.5.0; the settled design
decisions are in the "Now" section at the top. This section is kept for the argument.

**Raised by:** Chris, 2026-09-05, off the back of writing digger's `AGENTS.md`.

The mirror image of `safe()` above, and it comes from the same premise that section
already states: perfect filtering is unreachable. `safe()` answers the false
*positives* — redaction eating data the author knows is fine. This answers the false
*negatives*.

### The argument

Key- and pattern-based redaction is fail-open by construction: it masks what it
recognizes and passes everything else. A sensitive value under an **unremarkable key**
therefore survives — `?sid=`, `?u=`, a document id in a path. Nothing in the name marks
it, and no amount of pattern-tightening will, because the signal is not in the string.

Consumers work around this by hand. `digger` has `redactUrlForLog` (origin + path, query
dropped) and calls it at roughly half its URL-logging sites — the warn/error ones. The
info-level ones do not call it, which is the predictable outcome of any convention that
depends on remembering. Relocating that helper into this package as an *export* would
move the code and keep the problem; it only stops being a problem when the logger applies
it without being asked.

**But it must not be the default, and this is the part that constrains the design.**
Chris's objection, and it is correct: dropping query strings makes logs materially worse
at their job. In `digger` the query is frequently *the thing being analysed* — log
`example.com/search?q=foo` without its query and the line describes a different request
than the one that ran. These logs are already local, and the `log`/`debug` ones are off by
default behind a Debug Logging preference. *(Correction 2026-09-06: `warn`, `error`, and
`info` emit regardless of that preference — `src/logger.ts:279-317` — so "off by default"
holds only for the gated levels. Store builds suppress the console either way; "local"
is the load-bearing word.)* A debug log that omits the input is not a safer log,
it is a useless one, and users respond to useless logs by turning logging off — which is
strictly worse for their privacy than a detailed local log they never share.

The risk is not the log existing. It is the log being **shared**. So the control belongs
at the moment of sharing, which is a user action, which means a preference.

### Design constraints

- **Off by default.** Upgrading the package must not silently degrade any consumer's logs.
- **In the logger, not the call sites.** The whole failure of the manual approach is that
  call sites forget. Applying it automatically is the only version that fixes anything.
- **A preference, not config.** The person who knows a log is about to be pasted into a
  GitHub issue is the user, not the extension author. `LoggerPreferences` already exists
  and already carries `verboseLogging`, so the surface is there.
- **Composes with `safe()`.** A value the author marked safe stays visible; strict mode
  raises the floor, it does not override an explicit local assertion. Worth deciding
  deliberately rather than by accident of implementation order.
- **Cost is one checkbox per consuming extension.** Real, and the reason this is a
  preference rather than always-on.

### Sketch (not authoritative — SUPERSEDED by the settled decisions at the top of this file; the "long opaque path segments" rule below was rejected)

```ts
// LoggerPreferences
verboseLogging?: boolean;
strictRedaction?: boolean;   // new — off by default

// enableRedaction stops being a boolean and becomes a level
enableRedaction?: false | "standard" | "strict";
```

`standard` is today's behaviour exactly. `strict` additionally drops URL query strings
wholesale and treats long opaque path segments as suspect — the blunt pass that cannot be
fooled by a key name, accepted precisely because the user asked for it.

### Why it is worth doing rather than leaving to consumers

`docs/solutions/security-issues/json-stringify-tojson-defeats-key-based-redaction.md`
records key-based redaction failing open through a `toJSON()` bypass — severity critical,
and the fix restored the *same* key-based mechanism. Strict mode is defence in depth for
the narrower class it actually covers: a sensitive **URL query or fragment** under a key
nobody would flag. *(Correction 2026-09-06: it does not cover the `toJSON` relocation of
a bare secret onto an innocent key — that is closed by never invoking `toJSON`, not by
URL stripping.)*

### Open questions (all three answered in the settled decisions at the top; kept for the reasoning)

- Does strict mode subsume `redactUrlForLog` outright, letting `digger` delete its helper
  and its ~20 inconsistent call sites? Probably, and that is most of the value — but
  confirm against the sites that log a URL for its *path* rather than its host.
- Per-logger or per-extension? It is a user preference, so per-extension is the honest
  scope; a `child()` that could opt out would reintroduce the inherited-setting problem
  the `safe()` section already rejects.
- Does the preference need to be declared by each extension's manifest, or can the package
  ship a documented preference block consumers paste in? The latter is less work per
  consumer and keeps the copy consistent, which matters for a privacy control.

## Consumer rollout — hold LIFTED, target is 1.5 (updated 2026-09-06)

**Run this rollout once 1.5.0 is on npm, not before.** Chris's call, 2026-09-06 (option
B): the seven below `^1.4` go to 1.5 rather than waiting for 2.0. The earlier hold
(2026-08-25) was to avoid bumping twice, but the seven are still on the redaction that had
the critical `toJSON` fail-open, that cost scales with how long 2.0 takes, and for a
default-config consumer both the 1.5 and the 2.0 bump are lockfile-only changes — about
ten minutes per repo. Update `dep-gates.md` to match when 1.5 publishes.

Current census (2026-09-06): **12 extensions depend on the logger; 7 are below
`^1.4`.** Already current: `raycast-attio`, `raycast-digger`, `raycast-ios-apps`,
`raycast-karakeep`, `raycast-reader` — several picked it up alongside their own
`@raycast/api` 2.x moves. (Attio was missed by the 2026-08-30 count.)
| Extension | Range | Status |
| --- | --- | --- |
| `raycast-brew` | `^1.0.0` | below — oldest, predates all redaction work |
| `raycast-threads-client` | `^1.0.0` | below — oldest, predates all redaction work |
| `raycast-fetch` | `^1.2.2` | below |
| `raycast-fly` | `^1.2.2` | below |
| `raycast-tesla-energy` | `^1.2.2` | below |
| `raycast-bookface` | `^1.2.4` | below |
| `raycast-fathom` | `^1.2.4` | below |
| `raycast-digger` | `^1.4.0` | current |
| `raycast-ios-apps` | `^1.4.0` | current — first `@raycast/api` 2.x adopter |
| `raycast-karakeep` | `^1.4.0` | current — use as the reference bump |
| `raycast-reader` | `^1.4.0` | current |
| `raycast-attio` | `^1.4.0` | current |

**This census rots fast — it moved twice inside a single session.** Two repos in an
earlier count (`sora`, `parallel-web-tools`) are no longer present on disk at all.
Re-derive rather than trusting the numbers above:

```bash
cd ~/Developer/GitHub/chrismessina && node -e '
const fs=require("fs");
for (const d of fs.readdirSync(".").filter(x=>x.startsWith("raycast-")&&fs.existsSync(x+"/package.json"))) {
  const p=JSON.parse(fs.readFileSync(d+"/package.json","utf8"));
  const l={...(p.dependencies||{}),...(p.devDependencies||{})}["@chrismessina/raycast-logger"];
  if (l) console.log(l.padEnd(10), d);
}' | sort
```

This is recorded as a dependency gate in the plugin, committed as `b9c73b8`:
`raycast-extension-workflows/plugins/raycast-extensions/reference/dep-gates.md`.
That gate carries the operative rule so `ship`'s dep hygiene does not quietly undo
the hold: **an extension below the floor and not touching `@raycast/api` v2 should be
left alone.**

One hard prerequisite lives there too: logger `<= 1.3.0` with `@raycast/api` 2.x is a
hard `npm ERESOLVE` — not a warning, the install fails. Any v2 migration must bump
the logger first.

### Per-repo procedure (run once 1.5.0 is on npm)

```bash
npm view @chrismessina/raycast-logger version          # must print 1.5.x before you continue
npm install @chrismessina/raycast-logger@^1.5.0         # explicit range, never @latest — latest becomes 2.0 later
# The lockfile is what ships, not the manifest range — verify it moved:
node -p "require('./package-lock.json').packages['node_modules/@chrismessina/raycast-logger'].version"
npx tsc --noEmit && npm run lint && npm run build
```

Several of these repos carry uncommitted work, **including inside the two dependency
files themselves** — `raycast-ios-apps` was the live example: its `package.json` and
lockfile also held an unrelated in-flight `adm-zip` removal, so staging the whole files
would have bundled someone else's change into a security bump. So: never `git add -A`,
and stage the two files by **hunk** (`git add -p`), taking only the logger lines. If the
lockfile diff is not separable by hunk, stop and report rather than staging it.

### The behavior change to check per repo

1.2.x masked *any* key literally named `code` as a 2FA code — a real defect that hid
`ECONNREFUSED` from karakeep's logs and cost a debugging session. From 1.3.0, masking
is **value-dependent**, not key-dependent:

| `code` value | result |
| --- | --- |
| `"ECONNREFUSED"`, `"ENOENT"`, `"rate_limited"` | preserved — the fix |
| `"123456"`, `"1234"` (4-8 digits) | `******` — still masked |
| `404` (a number) | **`0`** — silently zeroed |

That last row is pre-existing (1.2.4 did it too), so it does not block a bump, but a
repo logging an HTTP status in a field named `code` has a live diagnostic hole.

**Check it per repo with a value-based probe, not a key-based one** — a single
non-numeric sample returns the value unchanged and reads as "`code` is never masked",
which is wrong:

```bash
node -e 'const r=require("./node_modules/@chrismessina/raycast-logger/dist/redaction.js");
for (const v of ["ECONNREFUSED","123456",404]) console.log(JSON.stringify(v),"->",JSON.stringify(r.redactValueByKey("code",v)));'
```

Note this only fires for a **structured** `{ code }` field. A `code` interpolated into
a message string (`` `exited with code ${code}` ``) goes through the string rules
instead, where only a 4-8 digit run adjacent to the label is masked.

---

# Shipped — kept for the analysis

## Shipped in 1.4.0 (2026-08-24)

### Over-redaction of REST paths, filesystem paths, and Docker image names

**Severity:** medium — no leak, but it destroys the debuggability the logger exists for
**Found:** 2026-08-11, in `raycast-karakeep` while diagnosing an N+1 request storm

### Problem

The URL-credential redaction shipped in 1.3.0 (see the analysis below) now masks
**whole REST paths whose ID segment merely looks token-shaped**. Karakeep list IDs
are nanoids, and every request to a per-list endpoint logged as `***`:

```
19:06:43 [API] GET /api/v1/lists          ← fine
19:06:43 [API] GET /api/v1/tags           ← fine
19:06:43 [API] GET ***?limit=10           ← should be /api/v1/lists/{nanoid}/bookmarks
19:06:43 [API] GET ***?limit=10 completed in 29.54ms { status: 200 }
```

45 consecutive lines of `***?limit=10`, indistinguishable from each other. The
query string survived; the path did not.

### Why it matters

The whole point of logging the request line is knowing **which** request. A
resource ID in a path segment is not a credential — it is an opaque identifier
that is useless without the `Authorization` header, which is redacted separately
and correctly. Masking it converts a useful log into 45 identical lines and hides
exactly the kind of defect the log is there to reveal (here: an N+1 fetch loop
that fired one request per list on every command open).

Note the asymmetry: `/api/v1/lists` and `/api/v1/tags` logged fine, so the
heuristic is firing on the **entropy of the path segment**, not on any credential
signal. Any REST API with opaque IDs — which is most of them — hits this.

### Needed fix

Narrow the URL redaction to the two positions that actually carry credentials:

1. **Userinfo** (`https://user:secret@host`) — keep as-is, this is correct.
2. **Query parameters** on the sensitive-name list — keep as-is, also correct.
3. **Do NOT redact path segments** on entropy alone. A high-entropy path segment
   is an ID, not a secret. If a path-segment rule must exist, gate it on an
   adjacent signal (`/token/`, `/key/`, `/secret/`, `/session/`) rather than on
   the shape of the segment itself.

### It is not only REST paths — two more shapes, same day

Later on 2026-08-11, the same karakeep extension added Docker logging and the
over-redaction reappeared on values that are not URLs at all:

```
configFiles: [ '***-app/docker-compose.yml' ]        ← /Users/<me>/Developer/Docker/karakeep-app/...
image: '***:v1.41.0'                                 ← getmeili/meilisearch:v1.41.0
```

A **filesystem path** and a **public Docker image name**. Neither is a
credential, neither is a URL, and both are the exact values you need to
reproduce a Docker problem. Note `ghcr.io/karakeep-app/karakeep:release` in the
same log object survived untouched, so whatever fires here is not matching on
"looks like an image reference" either — the `getmeili/...` form tripped it and
the `ghcr.io/...` form did not.

This widens the fix: the redaction is scanning **every string value** for
high-entropy or delimiter-ish shapes, not just URL positions. Restrict it to the
positions that can hold credentials (userinfo, sensitive query params, known
secret-bearing keys) and leave every other string alone.

### Root cause found — it is the base64 heuristic, not entropy (added 2026-08-13)

**Found:** 2026-08-13, in `raycast-context7`, where `→ GET /api/v1/tailwindlabs/tailwindcss.com`
logged as `→ GET ***.com` while `→ GET /api/v1/search` logged fine.

It is **not** an entropy measure. It is this line in `redactString`
(`dist/redaction.js`, the encoded-secret pass):

```js
output = output.replace(
  /(?<![A-Za-z0-9+/=])(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![A-Za-z0-9+/=])/g,
  (candidate) => /[A-Za-z]/.test(candidate) && /[0-9+/=]/.test(candidate) ? "***" : candidate,
);
```

**`/` is in the character class AND counts as a base64 "signal".** So a run of path
characters is treated as base64 body, and the slashes that make it obviously a *path*
are the very thing that satisfies the "has a non-letter" test. A candidate is masked
when all of the following hold:

1. an unbroken run of `[A-Za-z0-9+/]` — note `.`, `-`, `_` break the run, `/` does not
2. run length **≥ 20 and exactly divisible by 4** (the `{4}{5,}` quantifier)
3. the run contains at least one letter
4. the run contains at least one digit, `+`, `/`, or `=` — **a slash alone satisfies this**

Condition 2 is why this looked random: whether a path is masked depends on its
**length mod 4**, which is why two REST paths differing only by an ID length behave
differently, and why no entropy-based explanation fit.

**Verified against every case already documented above** (run on 1.3.0):

| Input | Output | Longest run | len % 4 |
| --- | --- | --- | --- |
| `getmeili/meilisearch:v1.41.0` | `***:v1.41.0` | `getmeili/meilisearch` (20) | 0 → masked |
| `ghcr.io/karakeep-app/karakeep:release` | *unchanged* | `app/karakeep` (12) | 0, but < 20 → kept |
| `/Users/messina/Developer/Docker/karakeep-app/docker-compose.yml` | `***-app/docker-compose.yml` | `/Users/…/karakeep` (40) | 0 → masked |
| `/api/v1/lists/abc123def456ghi/bookmarks` | *unchanged* | full path (39) | 3 → kept |
| `/api/v1/lists` | *unchanged* | (13) | 1 → kept |

That reproduces the exact strings in the Docker section above, including why
`ghcr.io/...` survived while `getmeili/...` did not — the `.` in `ghcr.io` breaks the
run below the length threshold. The asymmetry noted above is fully explained.

### Fix direction

Dropping `/` from the *signal* test (condition 4) is **not sufficient** — our
`/api/v1/tailwindlabs/tailwindcss` still contains the digit `1` from `v1` and would
keep matching. Two options that do work, ranked:

1. **Exclude candidates containing `/` from this pass entirely.** Real base64 in log
   text is overwhelmingly a bare token; base64 that legitimately contains `/` is
   almost always adjacent to a credential-shaped key or a `bearer` prefix, both of
   which are already handled by earlier passes. Cheapest fix, no false negatives that
   the other rules do not already catch.
2. **Require genuine base64 shape rather than "letter + something".** Mixed case *and*
   a digit, plus a minimum length well above 20, and reject candidates whose slash-
   delimited segments are dictionary-ish (all-lowercase words).

Option 1 is what I would ship; option 2 is what to reach for only if option 1 proves to
miss a real secret in practice.

### Suggested tests

- `/api/v1/tailwindlabs/tailwindcss.com` → **byte-identical to input** (32-char run, %4 = 0)
- `getmeili/meilisearch:v1.41.0` → byte-identical (20-char run, %4 = 0)
- A path deliberately built to be 20/24/28/32 chars → byte-identical at every length
- `/api/v1/lists/{nanoid}/bookmarks?limit=10` → **byte-identical to input**
- `/api/v1/bookmarks/{uuid}` → byte-identical
- `/users/{base64ish}/avatar` → byte-identical
- `https://user:secret@host/api/v1/lists/{nanoid}` → userinfo masked, path intact
- `?access_token=…` on a path with an ID → param masked, path intact
- `/Users/me/Developer/Docker/proj-app/docker-compose.yml` → byte-identical
- `getmeili/meilisearch:v1.41.0` and `ghcr.io/org/app:release` → both byte-identical
- an array of paths (`configFiles: [...]`) →each element byte-identical

---

**Resolution (1.4.0).** Fixed, but *not* by the "exclude candidates containing `/`"
option this analysis recommended — that turned out to be far too broad. Standard
base64 contains a literal `/` about 40% of the time (63% at PEM line length), so
skipping every slash-bearing candidate silently unmasked AWS secret access keys,
`Authorization: Basic <base64>` values, and PEM bodies. An independent review caught
it before release. The shipped rule discriminates on **path shape** instead — a
leading `/`, or a slash-delimited segment of four or more all-lowercase letters —
which keeps a genuine secret about 1.7% of the time rather than 40-63%.

## Shipped in 1.3.0 (2026-08-03)

### Redaction missed credentials embedded in URLs

**Severity:** high — silent credential leak into logs
**Found:** 2026-07-27, while adding the logger to `gh-pr-tracker`
**Affects:** `redactString` and `sanitizeArgs` (`src/redaction.ts`), v1.2.4

**Status:** Fixed in the current worktree with regression coverage for URL
userinfo, mixed-case sensitive query parameters, embedded URLs, benign URL
identity, malformed escapes, and nested structured values.

### Problem

Redaction catches bare tokens and `token:`-style fields, but **not a credential embedded in a URL**. Measured against v1.2.4 with a realistic PAT (`ghp_AbCdEf…`):

| Input | Result |
| --- | --- |
| `Request failed with token ghp_…` | ✅ `… token ghp_***` |
| `token ghp_…` (Authorization header value) | ✅ `token ghp_***` |
| `{ token: "ghp_…" }` via `sanitizeArgs` | ✅ `"***"` |
| `https://api.github.com/repos/o/r?access_token=ghp_…` | ❌ **passed through intact** |
| `https://user:ghp_…@ghe.example.com/api/v3/repos` | ❌ **passed through intact** |

`sanitizeArgs` does not protect these either — a structured `{ url: "…?access_token=…" }` field leaks in full.

### Why it matters

The logger's core promise is that you can log freely without leaking secrets. A URL is one of the most common things to log in a web-request extension (request failures, retries, rate-limit diagnostics), and query-param auth is widespread — GitHub, Airtable, and many APIs accept `?access_token=` / `?api_key=`. An extension author who logs `{ url }` on an error path reasonably expects redaction to cover it.

The failure is silent: no warning, no partial masking, the full credential lands in the console.

### Reproduction

```js
import { redactString, sanitizeArgs } from "@chrismessina/raycast-logger";

const PAT = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

redactString(`https://api.github.com/repos/o/r?access_token=${PAT}`);
// → unchanged; full PAT present

redactString(`https://user:${PAT}@ghe.example.com/api/v3/repos`);
// → unchanged; full PAT present

JSON.stringify(sanitizeArgs([{ url: `https://api.github.com/r?access_token=${PAT}` }]));
// → unchanged; full PAT present
```

### Needed fix

Add URL-aware redaction to `redactString` (and therefore `sanitizeArgs`): parse candidate URLs and scrub both credential positions.

1. **Userinfo** — `https://user:secret@host` → replace username and password.
2. **Sensitive query params** — at minimum `access_token`, `token`, `api_key`, `apikey`, `client_secret`, `password`, `secret`, `auth`, `key`. Match param names **case-insensitively**.
3. **Preserve everything else.** Path, host, and benign params (`per_page`, `page`) must be untouched — the URL still needs to be useful for debugging.
4. **Never throw on unparseable input.** Fall back to the existing pattern-based redaction rather than returning the raw string or raising.
5. Handle URLs **embedded in a larger message**, not only when the whole string is a URL — e.g. `` `GitHub API error: 403 for https://…?access_token=…` ``. This is the common shape, since errors interpolate URLs into a sentence.

A working reference implementation is in `/Users/messina/Developer/GitHub/chrismessina/gh-pr-tracker/src/logger.ts` (`safeUrl`), which covers items 1–4 for whole-URL strings. It does **not** cover item 5 — that's the part that needs real work here, since a naive regex over a sentence risks mangling non-URL text.

### Suggested tests

- Whole-URL string, userinfo form
- Whole-URL string, query-param form (each sensitive param name, mixed case)
- URL embedded mid-sentence in an error message
- URL with only benign params → **must be byte-identical to input**
- Malformed / non-URL string containing a token → falls back to pattern redaction, does not throw
- `sanitizeArgs` with `{ url }` as a nested object field

### Downstream note

`gh-pr-tracker` currently works around this with a local `safeUrl()` helper. Other fleet extensions that log request URLs are likely exposed and have no such guard. Once fixed here, the workaround should be removed rather than duplicated per extension.
