# Quick Start

Get up and running with `@chrismessina/raycast-logger` in 3 steps.

## Step 1: Install the Package

In your Raycast extension:

```bash
npm install @chrismessina/raycast-logger
```

## Step 2: Add Verbose Logging Preference

In your extension's `package.json`, add the preference:

```json
{
  "preferences": [
    {
      "name": "verboseLogging",
      "type": "checkbox",
      "required": false,
      "title": "Verbose Logging",
      "label": "Enable detailed logging",
      "description": "Show detailed logs in the console for debugging",
      "default": false
    }
  ]
}
```

## Step 3: Use the Logger

Import and use the logger in your extension:

```typescript
import { logger } from "@chrismessina/raycast-logger";

// Verbose logs (only shown when preference is enabled)
logger.log("Processing request", { userId: 123 });
logger.debug("Cache state", { hits: 42 });

// Always shown
logger.error("Failed to authenticate", error);
logger.warn("Rate limit approaching", { remaining: 10 });
logger.info("Extension initialized");
```

## That's it! 🎉

Enable "Verbose Logging" in your extension preferences and check the console for colorized logs.

---

## Bonus Features

### Performance Timing

```typescript
const done = logger.time("API call");
await fetchData();
done(); // Logs: "API call completed in 150.23ms"
```

### LLM-Friendly Step Tracking

Perfect for AI-assisted debugging sessions:

```typescript
logger.step(1, "Fetching user data", { userId });
logger.step(2, "Validating permissions");
logger.step(3, "Processing complete");
```

### Object Inspection

```typescript
logger.inspect("API Response", response);
// Outputs formatted, redacted JSON with clear delimiters
```

### Timestamps and File Context

For detailed debugging (great for LLM sessions):

```typescript
import { Logger } from "@chrismessina/raycast-logger";

const logger = new Logger({
  showTimestamp: true,  // [2026-01-05T10:30:00.000Z]
  showContext: true,    // [file.ts:42]
});
```

## Migration from Custom Logger

If migrating from a custom logger, extend `LoggerPreferences`:

```typescript
import { LoggerPreferences } from "@chrismessina/raycast-logger";

export interface ExtensionPreferences extends LoggerPreferences {
  apiKey: string;
  // ... your other preferences
}
```

## Next Steps

- Read [README.md](./README.md) for full API documentation and examples
- Check [CHANGELOG.md](./CHANGELOG.md) for version history
- View [WARP.md](./WARP.md) for development guidance
