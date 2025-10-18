# Setup Guide for @chrismessina/raycast-logger

## Initial Setup

1. **Install dependencies:**
   ```bash
   cd /Users/messina/Developer/GitHub/chrismessina/raycast-logger
   npm install
   ```

2. **Build the package:**
   ```bash
   npm run build
   ```

3. **Verify the build:**
   ```bash
   ls -la dist/
   # Should see: index.js, index.d.ts, logger.js, logger.d.ts, redaction.js, redaction.d.ts
   ```

## Testing Locally

Before publishing, test the package in your raycast-ios-apps extension:

### Option 1: Using npm link (Recommended)

```bash
# In the logger package directory
cd /Users/messina/Developer/GitHub/chrismessina/raycast-logger
npm link

# In your extension directory
cd /Users/messina/Developer/GitHub/chrismessina/raycast-ios-apps
npm link @chrismessina/raycast-logger
```

### Option 2: Using local file path

In your extension's `package.json`:
```json
{
  "dependencies": {
    "@chrismessina/raycast-logger": "file:../raycast-logger"
  }
}
```

Then run `npm install` in your extension.

## Publishing to NPM

### First-time setup

1. **Login to npm:**
   ```bash
   npm login
   ```

2. **Verify your account:**
   ```bash
   npm whoami
   ```

### Publishing

1. **Ensure everything is built:**
   ```bash
   npm run clean
   npm run build
   ```

2. **Test the package contents:**
   ```bash
   npm pack --dry-run
   ```

3. **Publish:**
   ```bash
   # For first release
   npm publish --access public

   # For subsequent releases
   npm version patch  # or minor, or major
   npm publish
   ```

## Version Management

- **Patch** (1.0.0 → 1.0.1): Bug fixes
  ```bash
  npm version patch
  ```

- **Minor** (1.0.0 → 1.1.0): New features, backward compatible
  ```bash
  npm version minor
  ```

- **Major** (1.0.0 → 2.0.0): Breaking changes
  ```bash
  npm version major
  ```

## Updating Your Extension

After publishing, update your extension:

```bash
cd /Users/messina/Developer/GitHub/chrismessina/raycast-ios-apps
npm install @chrismessina/raycast-logger@latest
```

## Migration Steps for raycast-ios-apps

1. **Install the package:**
   ```bash
   npm install @chrismessina/raycast-logger
   ```

2. **Update imports in all files:**
   
   Replace:
   ```typescript
   import { logger } from "./utils/logger";
   ```
   
   With:
   ```typescript
   import { logger } from "@chrismessina/raycast-logger";
   ```

3. **Update your types.ts:**
   
   Replace:
   ```typescript
   export interface ExtensionPreferences {
     appleId: string;
     password: string;
     verboseLogging?: boolean;
     // ... other preferences
   }
   ```
   
   With:
   ```typescript
   import { LoggerPreferences } from "@chrismessina/raycast-logger";
   
   export interface ExtensionPreferences extends LoggerPreferences {
     appleId: string;
     password: string;
     // ... other preferences
   }
   ```

4. **Remove old logger file:**
   ```bash
   rm src/utils/logger.ts
   ```

5. **Test thoroughly:**
   - Verify verbose logging works
   - Check that sensitive data is redacted
   - Test error and warning logs

## Troubleshooting

### Build errors about @raycast/api

This is expected before running `npm install`. The package uses `@raycast/api` as a peer dependency.

### "Cannot find module" errors

Make sure you've run `npm run build` after making changes to the source code.

### Testing changes locally

When developing the logger package:
1. Make changes in `src/`
2. Run `npm run build`
3. Changes will be reflected in linked extensions automatically

### Unlinking

If you need to unlink the package:
```bash
# In your extension
npm unlink @chrismessina/raycast-logger

# In the logger package
npm unlink
```
