/**
 * Redaction utilities for sanitizing sensitive data in logs
 */

/**
 * Mask email addresses, showing only first character and domain
 * @param text Text containing potential email addresses
 * @returns Text with masked emails
 * @example "user@example.com" → "u***@example.com"
 */
function maskEmail(text: string): string {
  return text.replace(
    /([A-Za-z0-9._%+-])[^@\s]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    (_m, p1: string, p2: string) => `${p1}***${p2}`,
  );
}

/**
 * Redact sensitive information from strings
 * @param input String that may contain sensitive data
 * @returns Sanitized string with sensitive data redacted
 */
export function redactString(input: string): string {
  let s = input;
  // Mask bearer tokens
  s = s.replace(/bearer\s+[^\s"']+/gi, "Bearer ***");
  // Mask key/value secrets
  s = s.replace(/(password|pass|pwd|secret|token|auth|authorization|key)\s*[:=]\s*[^\s&"']+/gi, "$1=***");
  // Mask 2FA codes when labeled
  s = s.replace(/((?:code|2fa|two[-\s]?factor|otp)\s*[:=\s]+)(\d{4,8})/gi, (_m, p1: string) => `${p1}******`);
  // Mask long hex/base64-like strings (potential tokens/hashes)
  s = s.replace(/[a-f0-9]{32,}/gi, "***");
  s = s.replace(/[A-Za-z0-9+/]{20,}={0,2}/g, "***");
  // Mask emails
  s = maskEmail(s);
  return s;
}

/**
 * Redact values based on their key names
 * @param key The property key name
 * @param value The value to potentially redact
 * @returns Redacted value if key indicates sensitive data
 */
function redactValueByKey(key: string, value: unknown): unknown {
  const k = key.toLowerCase();
  if (value == null) return value;

  if (typeof value === "string") {
    // Complete redaction for passwords and tokens
    if (["password", "pass", "pwd", "secret", "token", "auth", "authorization", "applepassword"].includes(k)) {
      return "***";
    }
    // Redact 2FA codes
    if (["code", "otp", "2fa", "twofactor", "two_factor"].includes(k)) {
      return "******";
    }
    // Partial masking for identifiers
    if (["email", "appleid", "apple_id", "username", "user"].includes(k)) {
      return maskEmail(value);
    }
    // Apply string redaction for other values
    return redactString(value);
  }

  if (typeof value === "number") {
    // Redact numeric codes
    if (["code", "otp", "2fa"].includes(k)) return 0;
    return value;
  }

  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value, (prop, val) => redactValueByKey(prop, val));
      return JSON.parse(json);
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * Sanitize an array of arguments for safe logging
 * @param args Array of arguments that may contain sensitive data
 * @returns Sanitized array safe for logging
 */
export function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === "string") return redactString(arg);
    if (typeof arg === "object" && arg !== null) {
      try {
        const json = JSON.stringify(arg, (key, value) => redactValueByKey(key, value));
        return JSON.parse(json);
      } catch {
        return arg;
      }
    }
    return arg;
  });
}
