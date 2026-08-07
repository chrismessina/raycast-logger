# raycast-logger — TODO

## Consumer rollout — 12 extensions still on pre-1.3.0 (added 2026-08-06)

**Why this matters:** 1.3.0 is security work — cyclic objects that returned the
**unredacted original**, `toJSON()` bypasses that moved a credential onto an innocent
key, and credentials embedded in URL userinfo/query params. Consumers pin `^1.x`, so a
*fresh* install resolves to 1.3.0 — but **the lockfile is what ships**, and every repo
below still has an older version pinned there. None of them get the fix until their
lockfile is regenerated.

**The four on `^1.0.0` are the most exposed** — that range predates the redaction work
entirely.

| Extension | Manifest range | Priority |
| --- | --- | --- |
| `raycast-brew` | `^1.0.0` | **high** |
| `raycast-ios-apps` | `^1.0.0` | **high** |
| `raycast-sora` | `^1.0.0` | **high** |
| `raycast-threads-client` | `^1.0.0` | **high** |
| `raycast-digger` | `^1.2.1` | medium |
| `raycast-fetch` | `^1.2.2` | medium |
| `raycast-fly` | `^1.2.2` | medium |
| `raycast-parallel-web-tools` | `^1.2.2` | medium |
| `raycast-reader` | `^1.2.2` | medium |
| `raycast-tesla-energy` | `^1.2.2` | medium |
| `raycast-bookface` | `^1.2.4` | low |
| `raycast-fathom` | `^1.2.4` | low |

`raycast-karakeep` is already on `^1.3.0` (done 2026-08-06) — use it as the reference.

### Per-repo procedure

```bash
npm install @chrismessina/raycast-logger@latest
jq -r '.packages["node_modules/@chrismessina/raycast-logger"].version' package-lock.json  # must read 1.3.0
npx tsc --noEmit && npm run lint && npm run build
```

- [ ] `raycast-brew`
- [ ] `raycast-ios-apps`
- [ ] `raycast-sora`
- [ ] `raycast-threads-client`
- [ ] `raycast-digger`
- [ ] `raycast-fetch`
- [ ] `raycast-fly`
- [ ] `raycast-parallel-web-tools`
- [ ] `raycast-reader`
- [ ] `raycast-tesla-energy`
- [ ] `raycast-bookface`
- [ ] `raycast-fathom`

### Two things that bit the karakeep bump — check for both

1. **A log field named `code` may now render differently.** 1.2.x masked *any* key
   literally named `code` as a 2FA code — a real defect that hid `ECONNREFUSED` from
   karakeep's logs and cost a debugging session. 1.3.0's head-noun matching no longer
   masks it. If a repo renamed a field to work around the old behavior, the workaround
   is now unnecessary (though harmless); if a repo logs a genuine `code`, it will start
   appearing in full. **Verify per repo rather than assuming:**

   ```bash
   node -e 'const r=require("./node_modules/@chrismessina/raycast-logger/dist/redaction.js");
   for (const k of ["code","errorCode","status","url","name","id"]) console.log(k, "->", r.redactValueByKey(k,"SAMPLE"));'
   ```

2. **Several of these repos have uncommitted work.** Stage only `package.json` and
   `package-lock.json`; never `git add -A`.

- [ ] Sweep once after the rollout to confirm every lockfile reads 1.3.0, not just the
      manifest range

---

# Shipped in 1.3.0 (2026-08-03) — kept for the analysis

## Redaction missed credentials embedded in URLs

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
