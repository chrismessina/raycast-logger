import { getPreferenceValues } from "@raycast/api";
import { redactString, sanitizeArgs } from "./redaction";

/**
 * Minimum preferences interface required for the logger
 */
export interface LoggerPreferences {
  verboseLogging?: boolean;
}

/**
 * Configuration options for the Logger
 */
export interface LoggerConfig {
  /**
   * Custom function to check if verbose logging is enabled
   * If not provided, will use getPreferenceValues<LoggerPreferences>()
   */
  isVerboseEnabled?: () => boolean;

  /**
   * Prefix to add to all log messages
   */
  prefix?: string;

  /**
   * Whether to enable automatic redaction of sensitive data
   * @default true
   */
  enableRedaction?: boolean;
}

/**
 * Logger utility that respects verbose logging preferences and automatically
 * redacts sensitive information from logs.
 *
 * @example
 * ```typescript
 * import { logger } from "@chrismessina/raycast-logger";
 *
 * // Basic usage (uses extension preferences)
 * logger.log("Processing request", { userId: 123 });
 * logger.error("Failed to authenticate", error);
 * logger.warn("Rate limit approaching");
 * ```
 *
 * @example
 * ```typescript
 * // Custom configuration
 * import { Logger } from "@chrismessina/raycast-logger";
 *
 * const customLogger = new Logger({
 *   prefix: "[MyExtension]",
 *   isVerboseEnabled: () => true, // Always log
 *   enableRedaction: true
 * });
 * ```
 */
export class Logger {
  private static instance: Logger;
  private config: Required<LoggerConfig>;

  constructor(config: LoggerConfig = {}) {
    this.config = {
      isVerboseEnabled: config.isVerboseEnabled || this.defaultVerboseCheck,
      prefix: config.prefix || "",
      enableRedaction: config.enableRedaction ?? true,
    };
  }

  /**
   * Default method to check if verbose logging is enabled
   * Reads from Raycast extension preferences
   */
  private defaultVerboseCheck(): boolean {
    try {
      const preferences = getPreferenceValues<LoggerPreferences>();
      return preferences.verboseLogging || false;
    } catch (error) {
      // If preferences can't be read, default to not logging
      console.error("[Logger] Failed to read preferences for verbose logging:", error);
      return false;
    }
  }

  /**
   * Get the singleton instance of the logger with default configuration
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Format a message with optional prefix
   */
  private formatMessage(message: string): string {
    if (this.config.prefix) {
      return `${this.config.prefix} ${message}`;
    }
    return message;
  }

  /**
   * Process message and arguments for logging
   */
  private processLogData(message: string, args: unknown[]): [string, unknown[]] {
    const formattedMessage = this.formatMessage(message);

    if (!this.config.enableRedaction) {
      return [formattedMessage, args];
    }

    return [redactString(formattedMessage), sanitizeArgs(args)];
  }

  /**
   * Log a message if verbose logging is enabled
   * @param message The message to log
   * @param args Additional arguments to log
   *
   * @example
   * ```typescript
   * logger.log("User logged in", { userId: 123, email: "user@example.com" });
   * // Output (if verbose enabled): User logged in { userId: 123, email: "u***@example.com" }
   * ```
   */
  public log(message: string, ...args: unknown[]): void {
    if (this.config.isVerboseEnabled()) {
      const [processedMessage, processedArgs] = this.processLogData(message, args);
      console.log(processedMessage, ...processedArgs);
    }
  }

  /**
   * Log an error message (always shown regardless of verbose setting)
   * @param message The error message to log
   * @param args Additional arguments to log
   *
   * @example
   * ```typescript
   * logger.error("Authentication failed", { password: "secret123" });
   * // Output: Authentication failed { password: "***" }
   * ```
   */
  public error(message: string, ...args: unknown[]): void {
    const [processedMessage, processedArgs] = this.processLogData(message, args);
    console.error(processedMessage, ...processedArgs);
  }

  /**
   * Log a warning message (always shown regardless of verbose setting)
   * @param message The warning message to log
   * @param args Additional arguments to log
   *
   * @example
   * ```typescript
   * logger.warn("API rate limit approaching", { remaining: 10 });
   * // Output: API rate limit approaching { remaining: 10 }
   * ```
   */
  public warn(message: string, ...args: unknown[]): void {
    const [processedMessage, processedArgs] = this.processLogData(message, args);
    console.warn(processedMessage, ...processedArgs);
  }

  /**
   * Create a child logger with a custom prefix
   * @param prefix Prefix to add to all messages from this logger
   * @returns New Logger instance with the specified prefix
   *
   * @example
   * ```typescript
   * const authLogger = logger.child("[Auth]");
   * authLogger.log("Login attempt"); // Output: [Auth] Login attempt
   * ```
   */
  public child(prefix: string): Logger {
    const childPrefix = this.config.prefix ? `${this.config.prefix} ${prefix}` : prefix;
    return new Logger({
      ...this.config,
      prefix: childPrefix,
    });
  }
}

/**
 * Default singleton logger instance for convenient use
 * Uses extension preferences to determine verbose logging
 *
 * @example
 * ```typescript
 * import { logger } from "@chrismessina/raycast-logger";
 *
 * logger.log("This only shows if verbose logging is enabled");
 * logger.error("This always shows");
 * logger.warn("This always shows");
 * ```
 */
export const logger = Logger.getInstance();
