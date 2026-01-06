import { getPreferenceValues } from "@raycast/api";
import { redactByKey, redactString, sanitizeArgs } from "./redaction";

/**
 * ANSI color codes for terminal output (zero dependencies)
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // Foreground colors
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

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

  /**
   * Whether to include timestamps in log messages
   * @default false
   */
  showTimestamp?: boolean;

  /**
   * Whether to include file/line context in log messages (LLM-friendly)
   * When enabled, logs include the calling location for easier debugging.
   * @default false
   */
  showContext?: boolean;

  /**
   * Whether to colorize log output using ANSI codes
   * @default true
   */
  colorize?: boolean;
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
      showTimestamp: config.showTimestamp ?? false,
      showContext: config.showContext ?? false,
      colorize: config.colorize ?? true,
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
   * Apply color codes to text if colorization is enabled
   */
  private colorize(text: string, ...codes: string[]): string {
    if (!this.config.colorize) return text;
    return `${codes.join("")}${text}${colors.reset}`;
  }

  /**
   * Extract calling context from stack trace (file:line)
   * Useful for LLMs to understand where logs originate.
   */
  private getCallerContext(): string | null {
    const stack = new Error().stack;
    if (!stack) return null;

    const lines = stack.split("\n");
    // Skip: Error, getCallerContext, formatMessage, processLogData, log/error/etc, and find caller
    for (let i = 5; i < lines.length; i++) {
      const line = lines[i];
      // Skip internal logger calls and node_modules
      if (line.includes("logger.") || line.includes("node_modules")) continue;

      // Extract file:line from stack frame
      // Matches patterns like "at foo (/path/file.ts:10:5)" or "at /path/file.ts:10:5"
      const match = line.match(/\(([^)]+):(\d+):\d+\)|at\s+([^:]+):(\d+):\d+/);
      if (match) {
        const file = match[1] || match[3];
        const lineNum = match[2] || match[4];
        // Get just the filename, not full path
        const fileName = file.split("/").pop() || file;
        return `${fileName}:${lineNum}`;
      }
    }
    return null;
  }

  /**
   * Format a message with optional timestamp, context, and prefix
   */
  private formatMessage(message: string, levelColor?: string): string {
    const parts: string[] = [];

    if (this.config.showTimestamp) {
      const timestamp = `[${new Date().toISOString()}]`;
      parts.push(this.colorize(timestamp, colors.gray));
    }

    if (this.config.showContext) {
      const context = this.getCallerContext();
      if (context) {
        parts.push(this.colorize(`[${context}]`, colors.dim));
      }
    }

    if (this.config.prefix) {
      parts.push(this.colorize(this.config.prefix, colors.magenta));
    }

    // Apply level color to the message if provided
    if (levelColor) {
      parts.push(this.colorize(message, levelColor));
    } else {
      parts.push(message);
    }

    return parts.join(" ");
  }

  /**
   * Process message and arguments for logging
   */
  private processLogData(message: string, args: unknown[], levelColor?: string): [string, unknown[]] {
    const formattedMessage = this.formatMessage(message, levelColor);

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
      const [processedMessage, processedArgs] = this.processLogData(message, args, colors.cyan);
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
   * // Output: [ERROR] Authentication failed { password: "***" }
   * ```
   */
  public error(message: string, ...args: unknown[]): void {
    const label = this.colorize("[ERROR]", colors.red, colors.bold);
    const [processedMessage, processedArgs] = this.processLogData(message, args, colors.red);
    console.error(label, processedMessage, ...processedArgs);
  }

  /**
   * Log a warning message (always shown regardless of verbose setting)
   * @param message The warning message to log
   * @param args Additional arguments to log
   *
   * @example
   * ```typescript
   * logger.warn("API rate limit approaching", { remaining: 10 });
   * // Output: [WARN] API rate limit approaching { remaining: 10 }
   * ```
   */
  public warn(message: string, ...args: unknown[]): void {
    const label = this.colorize("[WARN]", colors.yellow, colors.bold);
    const [processedMessage, processedArgs] = this.processLogData(message, args, colors.yellow);
    console.warn(label, processedMessage, ...processedArgs);
  }

  /**
   * Log an informational message (always shown regardless of verbose setting)
   * Use for important operational messages that aren't warnings or errors.
   * @param message The info message to log
   * @param args Additional arguments to log
   *
   * @example
   * ```typescript
   * logger.info("Server started", { port: 3000 });
   * // Output: [INFO] Server started { port: 3000 }
   * ```
   */
  public info(message: string, ...args: unknown[]): void {
    const label = this.colorize("[INFO]", colors.blue, colors.bold);
    const [processedMessage, processedArgs] = this.processLogData(message, args, colors.blue);
    console.info(label, processedMessage, ...processedArgs);
  }

  /**
   * Log a debug message (only shown if verbose logging is enabled)
   * Use for detailed diagnostic information during development.
   * @param message The debug message to log
   * @param args Additional arguments to log
   *
   * @example
   * ```typescript
   * logger.debug("Cache lookup", { key: "user:123", hit: true });
   * // Output (if verbose): [DEBUG] Cache lookup { key: "user:123", hit: true }
   * ```
   */
  public debug(message: string, ...args: unknown[]): void {
    if (this.config.isVerboseEnabled()) {
      const label = this.colorize("[DEBUG]", colors.gray);
      const [processedMessage, processedArgs] = this.processLogData(message, args, colors.gray);
      console.debug(label, processedMessage, ...processedArgs);
    }
  }

  /**
   * Start a timer for measuring operation duration
   * Returns a function that, when called, logs the elapsed time.
   * Timer logs respect verbose setting.
   * @param label Label for the timed operation
   * @returns Function to call when operation completes
   *
   * @example
   * ```typescript
   * const done = logger.time("API request");
   * await fetchData();
   * done(); // Output (if verbose): API request completed in 150.23ms
   *
   * // With additional context
   * const done = logger.time("Database query");
   * const results = await db.query(...);
   * done({ rows: results.length }); // Output: Database query completed in 45.00ms { rows: 100 }
   * ```
   */
  public time(label: string): (meta?: Record<string, unknown>) => void {
    const start = performance.now();
    return (meta?: Record<string, unknown>) => {
      const duration = performance.now() - start;
      const message = `${label} completed in ${duration.toFixed(2)}ms`;
      if (meta) {
        this.log(message, meta);
      } else {
        this.log(message);
      }
    };
  }

  /**
   * Log a numbered step in a sequence (LLM-friendly)
   * Helps LLMs understand execution flow by providing clear step markers.
   * @param step Step number or identifier
   * @param description What this step does
   * @param data Optional data relevant to this step
   *
   * @example
   * ```typescript
   * logger.step(1, "Fetching user data", { userId: 123 });
   * logger.step(2, "Validating permissions");
   * logger.step(3, "Updating database", { table: "users" });
   * // Output:
   * // [Step 1] Fetching user data { userId: 123 }
   * // [Step 2] Validating permissions
   * // [Step 3] Updating database { table: "users" }
   * ```
   */
  public step(step: number | string, description: string, data?: Record<string, unknown>): void {
    if (!this.config.isVerboseEnabled()) return;

    const label = this.colorize(`[Step ${step}]`, colors.cyan, colors.bold);
    const [processedMessage, processedArgs] = this.processLogData(description, data ? [data] : []);
    console.log(label, processedMessage, ...processedArgs);
  }

  /**
   * Log detailed object inspection (LLM-friendly)
   * Outputs a formatted, multi-line representation of an object.
   * Useful for debugging complex data structures.
   * @param label Label for the inspected value
   * @param value Value to inspect
   *
   * @example
   * ```typescript
   * logger.inspect("API Response", response);
   * // Output (if verbose):
   * // === API Response ===
   * // {
   * //   "status": 200,
   * //   "data": { ... }
   * // }
   * // === End API Response ===
   * ```
   */
  public inspect(label: string, value: unknown): void {
    if (!this.config.isVerboseEnabled()) return;

    const separator = "=".repeat(Math.max(0, 40 - label.length - 2));
    const header = this.colorize(`=== ${label} ${separator}`, colors.magenta, colors.bold);
    const footer = this.colorize(`=== End ${label} ${"=".repeat(Math.max(0, 36 - label.length))}`, colors.magenta);

    let formatted: string;
    try {
      if (this.config.enableRedaction) {
        const sanitized = JSON.parse(
          JSON.stringify(value, (key, val) => redactByKey(key, val)),
        );
        formatted = JSON.stringify(sanitized, null, 2);
      } else {
        formatted = JSON.stringify(value, null, 2);
      }
    } catch {
      formatted = String(value);
    }

    console.log(this.formatMessage(header));
    console.log(formatted);
    console.log(footer);
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
