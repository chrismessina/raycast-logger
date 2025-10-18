# Quick Start

Get up and running with `@chrismessina/raycast-logger` in 3 steps.

## Step 1: Build the Package

```bash
cd /Users/messina/Developer/GitHub/chrismessina/raycast-logger
npm install
npm run build
```

## Step 2: Link to Your Extension (for local testing)

```bash
# In the logger directory
npm link

# In your extension directory
cd /Users/messina/Developer/GitHub/chrismessina/raycast-ios-apps
npm link @chrismessina/raycast-logger
```

## Step 3: Update Your Extension Code

### Update imports

Find and replace in your extension:
```typescript
// OLD
import { logger } from "./utils/logger";

// NEW
import { logger } from "@chrismessina/raycast-logger";
```

### Update your types

In `src/types.ts`:
```typescript
import { LoggerPreferences } from "@chrismessina/raycast-logger";

export interface ExtensionPreferences extends LoggerPreferences {
  appleId: string;
  password: string;
  // ... your other preferences
}
```

### Ensure preference exists

In your extension's `package.json`, verify you have:
```json
{
  "preferences": [
    {
      "name": "verboseLogging",
      "type": "checkbox",
      "required": false,
      "title": "Verbose Logging",
      "description": "Show detailed logs in the console",
      "default": false
    }
  ]
}
```

## That's it!

Your extension now uses the shared logger package. Test it:

```bash
npm run dev
```

Enable "Verbose Logging" in your extension preferences and check the console for logs.

## Next Steps

- Read [SETUP.md](./SETUP.md) for publishing to npm
- Read [README.md](./README.md) for full API documentation
- Check [CHANGELOG.md](./CHANGELOG.md) for version history
