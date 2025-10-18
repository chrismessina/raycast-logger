/**
 * @chrismessina/raycast-logger
 *
 * A secure, preference-driven logger for Raycast extensions with automatic
 * redaction of sensitive data like passwords, tokens, and email addresses.
 */

export { Logger, logger, type LoggerConfig, type LoggerPreferences } from "./logger";
export { redactString, sanitizeArgs } from "./redaction";
