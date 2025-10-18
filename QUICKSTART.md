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

// Logs only if verbose logging is enabled
logger.log("Processing request", { userId: 123 });

// Always logged
logger.error("Failed to authenticate", error);
logger.warn("Rate limit approaching", { remaining: 10 });
```

If you're migrating from a custom logger, extend `LoggerPreferences` in your preferences interface:

```typescript
import { LoggerPreferences } from "@chrismessina/raycast-logger";

export interface ExtensionPreferences extends LoggerPreferences {
  apiKey: string;
  // ... your other preferences
}
```

## That's it!

Enable "Verbose Logging" in your extension preferences and check the console for logs.

## Next Steps

- Read [README.md](./README.md) for full API documentation and examples
- Check [CHANGELOG.md](./CHANGELOG.md) for version history
- View [WARP.md](./WARP.md) for development guidance
