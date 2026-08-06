---
module: redaction
date: 2026-08-06
problem_type: security_issue
component: tooling
severity: critical
symptoms:
  - "A logged object with a custom `toJSON()` emitted its `password` value verbatim because the replacer only ever saw the innocuous key it was relocated onto"
  - "An Error subclass defining `toJSON()` bypassed Error flattening entirely, losing name/message/stack normalization"
  - "The two-attempt BigInt retry serialized a second, different `toJSON()` snapshot after the first attempt threw"
  - "Key-name-based redaction reported success while secrets reached the log sink unmasked (fail-open)"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - logger
tags:
  - redaction
  - json-stringify
  - tojson
  - secret-leak
  - serialization
  - fail-closed
---

# `JSON.stringify`'s replacer is not a redaction boundary — `toJSON()` runs first

## Problem

`raycast-logger` redacts secrets by KEY NAME. Through v1.2.4, the traversal that
reached those keys was `JSON.stringify(arg, replacer)`. The pre-fix
implementation (`git show v1.2.4:src/redaction.ts`) ended `sanitizeArgs` with:

```js
const json = JSON.stringify(arg, (key, value) => redactByKey(key, value));
return JSON.parse(json);
```

That delegates traversal to the engine, and the engine does not hand the replacer
the value the caller passed in. Per the ECMAScript `SerializeJSONProperty`
algorithm the order is: read the property, call `toJSON()` on it if one exists,
THEN invoke the replacer with the *result*. The replacer is downstream of a
method the logged object controls.

So a value can relocate its own secret onto an innocent key before redaction ever
sees it:

```js
{ password: "hunter2", toJSON() { return { note: this.password } } }
```

The replacer was called with key `note`. `note` is in none of the three
credential sets (`src/redaction.ts:5-25`, `:46-63`, `:73`, combined by the policy
function `isCredentialKey` at `src/redaction.ts:107`), so the credential was
written to the log verbatim.

This is a critical defect in a package whose entire reason for existing is that
callers can hand it untrusted objects and trust the output. The redaction
boundary sat one step downstream of a caller-controlled hook.

A second, independent fail-open shipped in the same code path and is worth
recording alongside it: the pre-1.3.0 `sanitizeArgs` `catch` block returned the
ORIGINAL, UNREDACTED argument (`return arg;`) whenever `JSON.stringify` threw. A
cyclic object, a `BigInt` in an unexpected position, or a throwing getter
therefore produced a fully unredacted log line. Verified against the published
1.2.4 tarball: `sanitizeArgs([a])[0] === a` was `true`.

## Symptoms

Three distinct-looking bugs, one root cause — plus a second, independent
fail-open. All four are pinned as regression tests in `test/redaction.test.mjs`:

1. **Credential remapping.** `{ password, toJSON(){ return { note: this.password } } }`
   logged the password in full. Test: `test/redaction.test.mjs:568`.
2. **Error flattening bypassed entirely.** An `Error` subclass carrying a
   `toJSON` never reached the `instanceof Error` branch, because serialization
   called `toJSON` before any type dispatch happened. Test:
   `test/redaction.test.mjs:592`.
3. **Second-snapshot smuggling.** The interim implementation retried
   serialization (attempt 1 plain, attempt 2 with `BigInt` coercion), which
   invoked `toJSON()` a SECOND time. A value returning `{ n: 1n }` first —
   forcing the throw — and `{ note: secret }` second leaked on the retry. Test:
   `test/redaction.test.mjs:580`.
4. **Fail-open on throw.** Any `JSON.stringify` failure returned the original
   object unredacted (see Problem).

Symptoms 1–3 do not look related in a bug tracker. They are the same defect:
*the redaction boundary sat downstream of a hook the logged value controls.*

## What Didn't Work

The most transferable part of this incident is not the fix — it is **why review
did not catch it.**

The maintainer had already probed this exact area adversarially. The probe was
`{ toJSON() { return { password: "X" } } }` — a `toJSON` that puts a secret in
its RETURN VALUE, on a credential-named key. That case redacts correctly: the
replacer sees key `password` and masks it. The probe passed, and passing read as
"`toJSON` is handled."

It was one step short. The exploit requires the secret to be **moved** by
`toJSON` from a credential key to an innocent one. Same method, opposite
direction, and the difference between "handled" and "wide open."

Two things generalize:

- **The probe was drawn from the same mental model as the code.** Both the
  implementation and the test asked "what if a secret appears under `toJSON`?"
  Neither asked "what if `toJSON` *renames* the key?" Same-family review — the
  author re-reading their own work, or a reviewer primed by the author's framing —
  reliably tests the neighborhood it is already standing in. An independent
  reviewer (Codex, run adversarially against the branch) found the remapping case.
- **A passing adversarial test is weak evidence.** It proves the case you
  imagined is covered. It says nothing about the case one step outside it, and
  it *feels* like it does. That feeling is the failure mode.

The immediate predecessor work shows how close this came to being caught and was
not. A security pass one day earlier (2026-08-01) hardened this same file: it
established that masking must be **value-type agnostic** — a numeric `twofactor`
and object-valued credentials were both passing through unmasked — and it closed
the circular-structure fail-open. Both are the same family as this bug: *the
key-name matcher only sees what the serializer hands it.* That pass stopped at
"mask regardless of value type" and "don't fail open"; it never asked whether a
logged object could rename its own key before the matcher ran. (session history)

Also insufficient, and worth naming so nobody retries them:

- **Extending the key list.** No credential-key set can help when the attacker
  chooses the key. `note` is not a secret name and never should be.
- **Post-processing the serialized JSON string.** Once `toJSON` has run the
  provenance is gone — a masked-by-content pass cannot tell `note: "hunter2"`
  from any other short string, so it either misses secrets or destroys
  diagnostics.
- **Wrapping the retry.** The two-attempt retry was itself a symptom; removing
  only the second `toJSON` invocation would have left symptoms 1 and 2 intact.

## Solution

Shipped in v1.3.0. The walker that fixes this landed in commit `e7ce6c4`
("close type-dispatch, hostile-builtin, and encoded-URL redaction bypasses") —
note that `8cef6e3`, despite its subject line "harden redaction and fail closed
on unserializable values", is the *interim* state that still used
`JSON.stringify` and introduced the two-attempt retry of symptom 3. The release
also contains `a629fae` (unify message + structured policy), `4b3ea1f` (dedupe
credential sets), `a54abff` (recursion depth, all-caps keys, deep encoding), and
`371c8a2` (docs). All verified reachable from the current tree. These landed as
direct commits; this repo has no PRs for the work (`gh pr list --state all`
returns only Dependabot #1 and #2).

**`JSON.stringify` was removed from the traversal path entirely.** It is replaced
by `safeTree()`, a direct recursive walker at `src/redaction.ts:610` (rationale
in the doc comment at `src/redaction.ts:587-609`). The walker never invokes
`toJSON`. Relevant properties of the new implementation:

- **The credential-key guard runs FIRST, before any type dispatch**
  (`src/redaction.ts:619`). Placing it after the primitive branches meant
  `{ token: 123n }`, `{ token: Symbol("s") }`, and `{ token: namedFn }` each
  converted themselves to text and returned before the guard was reached.
- **Built-ins whose `toJSON`/`toString` carried real meaning are special-cased
  and read through INTRINSIC prototype methods**, so a subclass or own-property
  override cannot substitute an arbitrary string:
  - `Date` — `Date.prototype.getTime.call(object)` then
    `Date.prototype.toISOString.call(object)` (`src/redaction.ts:650-653`).
  - `RegExp` — `RegExp.prototype.toString.call(object)`, result still passed
    through `redactString` (`src/redaction.ts:654`).
  - `URL` — the `href` getter pulled off the prototype descriptor:
    `Object.getOwnPropertyDescriptor(URL.prototype, "href")?.get?.call(object)`
    (`src/redaction.ts:655-658`).
- **`Map` and `Set` render `{}`** (`src/redaction.ts:661`), matching what
  `JSON.stringify` emitted in v1 — deliberately not newly exposing their contents.
- **`Error` is flattened by `errorToTree`** (`src/redaction.ts:642` dispatch,
  function at `src/redaction.ts:555`). Because no `toJSON` runs first, the
  `instanceof Error` branch is now actually reachable.
- **Traversal is bounded**: `MAX_DEPTH = 12`, `MAX_OBJECT_ENTRIES = 200`,
  `MAX_ARRAY_ENTRIES = 500` (`src/redaction.ts:529-531`), with over-limit
  containers emitting truncation markers rather than silently dropping data.
- **Cycles render `[Circular]` with siblings preserved.** The `seen` set is
  PATH-scoped, not global — `seen.delete(object)` runs in a `finally`
  (`src/redaction.ts:682-686`), so the same object appearing twice in a tree is
  rendered twice instead of being falsely reported as a cycle.
- **Properties are attached with `Object.defineProperty`, never plain
  assignment** (`defineEntry`, `src/redaction.ts:542`). Plain
  `record["__proto__"] = value` invokes the inherited setter and reparents the
  result object.
- **It now fails CLOSED.** `redactedClone` (`src/redaction.ts:689`) catches
  anything the walk throws and returns
  `` `[unserializable ${type} — withheld to avoid logging unredacted data]` ``
  (`src/redaction.ts:699`), with the type inspection itself wrapped because a
  hostile `Symbol.toStringTag` getter can throw too.

### Behavior change this forces

Objects that relied on `toJSON()` to shape their log output now render their own
enumerable properties instead. That is intended and unavoidable: honoring
`toJSON` is exactly the bypass.

**Getters ARE still invoked** — `safeTree` reads properties normally at
`src/redaction.ts:678`, matching v1 behavior. A throwing getter propagates and is
converted to the withheld marker by `redactedClone`. This is a redaction
boundary, not a side-effect-free snapshotter; do not describe it as one.

## Why This Works

The fix is a boundary relocation, not a filter improvement.

Key-based redaction is only sound if the redactor sees the keys the *caller's
object actually has*. `JSON.stringify` breaks that precondition by design:
`toJSON` is a documented, intentional escape hatch that lets a value present a
different shape to serialization. Redacting on that presented shape means the
value being inspected gets to choose what the inspector sees. No amount of
key-list tuning fixes an inspector standing downstream of its subject.

Walking the value ourselves puts the inspector upstream. Own enumerable keys are
read directly (`Object.keys`, `src/redaction.ts:674`), and the policy function
decides on the real key. There is no hook between the object and the redactor.

The intrinsic-prototype reads close the same class of hole one level down. A
special case for `Date` that called `object.toISOString()` would have
reintroduced exactly the original bug — an overridable method on the logged value
deciding what gets logged. `Date.prototype.toISOString.call(object)` reads the
built-in's behavior regardless of what the instance claims. Pinned by
`test/redaction.test.mjs:741`, which uses a `Date` subclass overriding
`toISOString`, a `RegExp` with an own `toString`, and a `URL` with an own `href`
getter.

Fail-closed matters for the same reason. A redactor that returns raw data on
error has a worse failure mode than one that returns nothing, because callers
cannot distinguish "redacted successfully" from "gave up and passed through."
The withheld marker makes the failure legible in the log.

## Prevention

**1. Never use `JSON.stringify`'s replacer as a security boundary.** The replacer
runs after `toJSON()`. Any policy keyed on property names is defeated by a value
that renames its own properties. This applies to `replacer` functions, replacer
*arrays*, and anything built on `JSON.parse(JSON.stringify(x, f))`. If the value
is untrusted, walk it yourself.

**2. Read built-ins through intrinsic prototype methods, never the instance.**
`Date.prototype.toISOString.call(x)`, `RegExp.prototype.toString.call(x)`,
`Object.getOwnPropertyDescriptor(URL.prototype, "href")?.get?.call(x)`. Anywhere
a security-relevant path calls a method *on* the untrusted value, the value picks
the answer.

**3. Attach walked properties with `Object.defineProperty`, not assignment** —
otherwise a `__proto__` key in the payload reparents your output object
(`src/redaction.ts:542`).

**4. Assert the POSITIVE, not only the absence of the secret.** This is the
testing rule that generalizes furthest. A test shaped like:

```js
assert.doesNotMatch(output, /LEAK123/);
```

passes against a mutation that withholds *everything* — a redactor that returns
`"[withheld]"` for all input satisfies every absence assertion in the suite while
destroying the product. Pair every absence assertion with a positive one: that a
diagnostic sibling survived, or that the mask marker is present. Examples in this
repo worth copying:

- `test/redaction.test.mjs:737` — asserts the mask marker is present alongside
  the leak check.
- `test/redaction.test.mjs:756-760` — after asserting the hostile overrides did
  not emit their strings, asserts the intrinsic values still came through, with
  the in-test comment stating why: *"Absence alone would be satisfied by
  withholding all three."*
- `test/redaction.test.mjs:605-607` — the Error-subclass test asserts
  `safe message` and `LeakyError` survive, not just that the secret is gone.

**5. Pin the INVARIANT, not the output.** "The secret is absent" is a weaker
claim than "`toJSON` is never called." A regression that invokes `toJSON` once
and happens to emit a benign first snapshot satisfies the former and violates the
latter. Count the invocations:

```js
let calls = 0;
const value = { safe: "visible", toJSON() { calls += 1; return { note: "from-toJSON" }; } };
const output = JSON.stringify(sanitizeArgs([value]));
assert.equal(calls, 0, "toJSON must never be invoked");
assert.match(output, /visible/);              // positive: real data survived
assert.doesNotMatch(output, /from-toJSON/);   // negative: hook output absent
```

That is `test/redaction.test.mjs:763`.

**6. When you write an adversarial probe, write the one-step-outside variant
too.** The probe that missed this bug put a secret in `toJSON`'s return value.
The bug needed `toJSON` to MOVE a secret between keys. Before trusting a passing
security probe, ask what the *inverse*, the *permutation*, and the *rename* of
that probe look like — and get an independent reviewer, ideally not from the same
family as the one that wrote the code, to look at the seams.

**7. Fail closed at every catch site on a redaction path.** Grep for `catch` in
any sanitizer and confirm no branch returns caller data. The v1.2.4 regression
was a single `return arg;`.

**Residual hazard.** `redactByKey` is still exported and its doc comment at
`src/redaction.ts:478-479` still reads *"safe to use as JSON.stringify replacer /
Does NOT recurse into objects; lets JSON.stringify handle traversal"*, with
`src/redaction.ts:525` adding *"Return objects/arrays as-is; JSON.stringify will
recurse into them."* Inside v1.3.0 its actual usage is sound — a per-value
primitive policy called from `safeTree` (`src/redaction.ts:626`) and
`redactValueByKey` (`src/redaction.ts:719`). But that docstring invites a
consumer, or a future maintainer, to reinstate exactly the pattern this incident
removed. Treat it as a docstring to correct, not as supported usage.

## Related Issues

- No GitHub issues; this repo has none. The work landed as direct commits on
  `main`, released as `v1.3.0`.
- `CHANGELOG.md` (v1.3.0, Security section) states the mechanism in release terms.
- `AGENTS.md` records the rule for future agents working in this repo: objects are
  walked directly and `JSON.stringify` is not used for traversal.
- `README.md` documents the consumer-visible consequence — a custom `toJSON()` is
  never invoked, and getters still are.
- `.github/.private/docs/v2-proposal.md` **is stale against this learning**: it
  still scopes the bounded walker as future v2.0.0 work (it shipped in v1.3.0),
  specifies "does not invoke getters or `toJSON`" when shipped behavior
  deliberately invokes getters, and cites `src/redaction.ts:244`/`:246` for a
  function that no longer exists.
