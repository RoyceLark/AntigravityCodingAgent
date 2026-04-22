# 🔧 Self-Healing Quick Reference

## What Gets Fixed Automatically?

✅ **TypeScript Errors**
- Type mismatches
- Missing properties
- Incorrect method signatures
- Import errors

✅ **Build Errors**
- Webpack compilation errors
- Module resolution issues
- Syntax errors

✅ **Linting Issues**
- ESLint errors
- Code style violations

## Status Bar Controls

```
🔧 Self-Healing: ON  ← Click to toggle
```

- **Green/ON**: Actively monitoring and fixing errors
- **Gray/OFF**: Disabled, errors not auto-fixed

## Commands

### 1. Toggle Self-Healing
```
Ctrl+Shift+P → "Toggle Self-Healing (Auto Error Fix)"
```
Enables/disables the autonomous fixing system

### 2. Manual Scan
```
Ctrl+Shift+P → "Scan and Fix Errors Now"
```
Immediately scans workspace and fixes all detected errors

### 3. View History
```
Ctrl+Shift+P → "View Self-Healing Fix History"
```
Shows list of all automatically applied fixes

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  1. You save a file with errors                     │
│  2. Extension detects errors via diagnostics        │
│  3. AI analyzes error context                       │
│  4. AI generates fixed code                         │
│  5. Fix is applied automatically                    │
│  6. You get a notification                          │
│  7. Continue coding!                                │
└─────────────────────────────────────────────────────┘
```

## Example Fix

**Before (Error):**
```typescript
agent.createdAt  // ❌ Property 'createdAt' does not exist
```

**After (Auto-Fixed):**
```typescript
agent.startedAt  // ✅ Automatically corrected
```

**Notification:**
```
✅ Successfully fixed 1 error(s) in AgentManagerPanel.ts
```

## Safety Features

🛡️ **Built-in Safeguards:**
- Only fixes one file at a time
- Preserves file backups (use Git!)
- Shows notifications for all changes
- Maintains fix history
- Can be disabled anytime

## Best Practices

1. **Use Version Control**: Always commit before letting AI fix errors
2. **Review Fixes**: Check the fix history periodically
3. **Start Small**: Test on non-critical files first
4. **Monitor Output**: Watch the Output panel for details
5. **Toggle as Needed**: Disable for critical/production code

## Troubleshooting

### Self-Healing Not Working?

**Check 1: Is it enabled?**
```
Look for "🔧 Self-Healing: ON" in status bar
```

**Check 2: API configured?**
```
Settings → Cnx → AI Provider & API Key
```

**Check 3: Are there errors?**
```
Problems panel should show TypeScript errors
```

**Check 4: View logs**
```
Output panel → Select "Cnx Agent"
```

### Disable Self-Healing

**Method 1: Status Bar**
```
Click "🔧 Self-Healing: ON" → Toggles to OFF
```

**Method 2: Command Palette**
```
Ctrl+Shift+P → "Toggle Self-Healing"
```

## When to Use

✅ **Good Use Cases:**
- Fixing TypeScript migration errors
- Correcting API signature changes
- Batch fixing linting issues
- Learning from AI-generated fixes

⚠️ **Use with Caution:**
- Production-critical code
- Complex business logic
- Security-sensitive code
- Before major releases

## Performance Tips

- **Disable when not needed**: Toggle off during intensive coding sessions
- **Use manual scan**: Run "Scan and Fix" when you're ready, not continuously
- **Monitor fix history**: Keep track of what's being changed

---

**Remember**: Self-Healing is a powerful assistant, not a replacement for code review!
Always verify fixes in critical code paths.
