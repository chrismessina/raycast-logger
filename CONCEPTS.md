# Concepts

Shared domain vocabulary for this project — entities, named processes, and status
concepts with project-specific meaning. Seeded with core domain vocabulary, then
accretes as ce-compound and ce-compound-refresh process learnings; direct edits
are fine. Glossary only, not a spec or catch-all.

## Redaction

### Redaction
The process of replacing sensitive values in log output with masks while leaving
everything else byte-identical. It is a security boundary, not a formatting
convenience: a change that lets a credential through is a vulnerability.

Redaction runs on two paths that must agree — one over free-form message strings,
one over structured values — and both consult the same classification rule, so
they cannot disagree about what counts as a secret. It is defense in depth, not a
guarantee: an unlabeled value that looks like ordinary prose cannot reliably be
distinguished from one, so callers are still expected not to log known secrets.

### Credential Key
A property name whose presence marks its value as a secret, causing the value to
be masked whole regardless of the value's runtime type.

Classification is deliberately asymmetric because both directions of error are
failures. Some words qualify only as an exact whole key, some only as a compound
key's head noun, and some anywhere in a compound key. Words that are heavily
overloaded in ordinary code are excluded from the looser rules, because masking a
non-secret destroys the diagnostic value the logger exists to provide, while
missing a secret leaks it.

### Withheld Marker
The placeholder emitted in place of a value that could not be safely inspected —
a hostile accessor, an unrepresentable structure — signalling that the logger
gave up rather than passing the value through.

Its existence is the visible form of the fail-closed rule: a redactor that
returns raw data on error is worse than one that returns nothing, because the
reader cannot tell "redacted successfully" from "gave up." The marker makes that
distinction legible in the log.

## Log emission

### Emitted
That the logger called the corresponding console method. Distinct from *visible*:
Raycast suppresses console output for extensions installed from the Store, so an
emitted line reaches a developer running locally but not an end user.

The distinction is load-bearing. Documentation that described the
always-emitted levels as "always shown" was factually wrong for every Store
install, and implied these levels were a channel for reaching users — they are
not. Anything a user must act on belongs in the extension's UI.

### Verbose Gating
The rule that some log levels emit only when the extension's verbose-logging
preference is enabled, while others emit regardless of it.

Gating is about developer noise, not severity. The gated levels are for routine
diagnostics and tracing; the ungated ones are for conditions a developer would
want to see without opting in. Neither group is visible in a Store install — see
*Emitted*.

## Flagged ambiguities

- *redact* and *sanitize* have both been used for the same operation. The public
  surface exposes both spellings, so neither can be retired; treat them as
  synonyms for the single process defined under **Redaction** rather than as two
  distinct behaviors.
