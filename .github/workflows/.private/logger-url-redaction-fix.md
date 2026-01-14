# Fix Overly Aggressive URL Redaction in raycast-logger

## Problem Summary

The `redactString()` function in `src/redaction.ts` incorrectly redacts parts of URLs. URL paths containing alphanumeric sequences are being matched by hex/base64 detection regexes, breaking the URLs in log output.

## Current Behavior (Broken)

### Example from Production Logs

**Input:**

```text
url: 'https://www.nytimes.com/2025/01/13/opinion/openai-ai-bubble-financing.html?unlocked_article_code=1.EFA.VKmJ.QjFhwfgQcLNe'
```

**Current Output:**

```text
url: 'https://www.nytimes.***-ai-bubble-financing.html?unlocked_article_code=1.EFA.VKmJ.QjFhwfgQcLNe'
```

The path segment `com/2025/01/13/opinion/openai` is incorrectly redacted because it matches the base64-like pattern `[A-Za-z0-9+/]{20,}`.

---

## Test Cases

### ✅ URLs That Should NOT Be Redacted

These are legitimate URLs that must remain intact:

| Input | Expected Output |
|-------|-----------------|
| `https://www.nytimes.com/2025/01/13/opinion/openai-ai-bubble-financing.html` | `https://www.nytimes.com/2025/01/13/opinion/openai-ai-bubble-financing.html` |
| `https://example.com/path/to/resource?query=value` | `https://example.com/path/to/resource?query=value` |
| `https://github.com/chrismessina/raycast-logger/commit/fd6c2f9a2ccaa28462008d8a084c6f81d9ef917c` | `https://github.com/chrismessina/raycast-logger/commit/fd6c2f9a2ccaa28462008d8a084c6f81d9ef917c` |
| `https://api.example.com/v1/users/12345/profile` | `https://api.example.com/v1/users/12345/profile` |
| `https://cdn.example.com/assets/images/logo_v2_final.png` | `https://cdn.example.com/assets/images/logo_v2_final.png` |
| `http://localhost:3000/api/health` | `http://localhost:3000/api/health` |
| `https://example.com/search?q=test&page=1&sort=date` | `https://example.com/search?q=test&page=1&sort=date` |
| `https://archive.org/web/20240101000000/https://example.com` | `https://archive.org/web/20240101000000/https://example.com` |

### ✅ Secrets That SHOULD Be Redacted

These contain sensitive data and must be redacted:

| Input | Expected Output |
|-------|-----------------|
| `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0` | `Bearer ***` |
| `token: abc123def456abc123def456abc123def456` | `token: ***` |
| `password=mysecretpassword123` | `password=***` |
| `apiKey: sk_live_abc123def456ghi789jkl012mno345` | `apiKey: ***` |
| `Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=` | `Authorization: ***` |
| `secret=aGVsbG8gd29ybGQgdGhpcyBpcyBhIHNlY3JldA==` | `secret=***` |
| `user@example.com` | `u***@example.com` |
| `code: 123456` | `code: ******` |
| `2fa: 987654` | `2fa: ******` |

### ❌ Negative Examples (Current Bugs)

These are currently broken and need to be fixed:

| Input | Current (Wrong) Output | Expected Output |
|-------|------------------------|-----------------|
| `https://www.nytimes.com/2025/01/13/opinion/openai-ai-bubble-financing.html` | `https://www.nytimes.***-ai-bubble-financing.html` | URL unchanged |
| `https://github.com/user/repo/commit/fd6c2f9a2ccaa28462008d8a084c6f81d9ef917c` | `https://github.com/user/repo/commit/***` | URL unchanged |
| `Fetching https://api.example.com/v1/users/profile` | `Fetching https://api.***` | URL unchanged |

---

## Root Cause Analysis

The problematic regexes in `redactString()`:

```typescript
// This matches URL paths that happen to be 32+ hex chars
s = s.replace(/[a-f0-9]{32,}/gi, "***");

// This matches URL paths that look like base64 (20+ alphanumeric chars)
s = s.replace(/[A-Za-z0-9+/]{20,}={0,2}/g, "***");
```

These patterns are too greedy and don't account for the context (URLs vs actual secrets).

---

## Recommended Solution

### Approach: Preserve URLs Before Redaction

Extract and preserve URLs before applying other redactions, then restore them afterward:

```typescript
export function redactString(input: string): string {
  // Step 1: Preserve URLs by replacing them with placeholders
  const urlPlaceholders: string[] = [];
  let s = input.replace(
    /https?:\/\/[^\s"'<>\])}]+/gi,
    (match) => {
      urlPlaceholders.push(match);
      return `__URL_PLACEHOLDER_${urlPlaceholders.length - 1}__`;
    }
  );

  // Step 2: Apply existing redactions (these won't touch the placeholders)
  s = s.replace(/bearer\s+[^\s"']+/gi, "Bearer ***");
  s = s.replace(
    /(password|pass|pwd|secret|token|auth|authorization|key)\s*[:=]\s*[^\s&"']+/gi,
    "$1=***"
  );
  s = s.replace(
    /((?:code|2fa|two[-\s]?factor|otp)\s*[:=\s]+)(\d{4,8})/gi,
    (_m, p1: string) => `${p1}******`
  );
  s = s.replace(/[a-f0-9]{32,}/gi, "***");
  s = s.replace(/[A-Za-z0-9+/]{20,}={0,2}/g, "***");
  s = maskEmail(s);

  // Step 3: Restore URLs
  s = s.replace(
    /__URL_PLACEHOLDER_(\d+)__/g,
    (_, idx) => urlPlaceholders[parseInt(idx)]
  );

  return s;
}
```

### URL Regex Explanation

The URL pattern `https?:\/\/[^\s"'<>\])}]+` matches:

- `https?://` — http or https scheme
- `[^\s"'<>\])}]+` — any characters except whitespace and common delimiters

This handles URLs in various contexts:

- Plain text: `Fetching https://example.com/path`
- JSON: `"url": "https://example.com/path"`
- Markdown: `[link](https://example.com/path)`
- Logs: `url: 'https://example.com/path'`

---

## Files to Modify

- `src/redaction.ts` — modify the `redactString()` function

---

## Verification

After implementing, run these test cases:

```typescript
import { redactString } from "./redaction";

// URLs should NOT be redacted
console.assert(
  redactString("https://www.nytimes.com/2025/01/13/opinion/openai-ai-bubble-financing.html") ===
  "https://www.nytimes.com/2025/01/13/opinion/openai-ai-bubble-financing.html"
);

console.assert(
  redactString("https://github.com/user/repo/commit/fd6c2f9a2ccaa28462008d8a084c6f81d9ef917c") ===
  "https://github.com/user/repo/commit/fd6c2f9a2ccaa28462008d8a084c6f81d9ef917c"
);

// Secrets SHOULD be redacted
console.assert(
  redactString("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0").includes("Bearer ***")
);

console.assert(
  redactString("password=mysecretpassword123") === "password=***"
);

// Mixed content
console.assert(
  redactString("Fetching https://api.example.com/users with token: abc123def456abc123def456abc123def456") ===
  "Fetching https://api.example.com/users with token: ***"
);
```

---

## Edge Cases to Consider

1. **URLs with query params containing tokens**: `https://example.com/auth?token=abc123` — the URL should be preserved, but if the token param is explicitly labeled, consider whether to redact just that param
2. **Data URLs**: `data:image/png;base64,iVBORw0KGgo...` — these are not http URLs and may still be redacted (acceptable)
3. **URLs in JSON strings**: `{"url": "https://example.com"}` — must work correctly
4. **Multiple URLs in one string**: All should be preserved
5. **Malformed URLs**: `https://` alone should not break the regex
