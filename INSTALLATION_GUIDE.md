# 🚀 Cnx Agent Extension - Installation & Usage Guide

## 📦 Installation

### Step 1: Locate the Extension Package
The extension has been packaged as: `cnx-agent-0.2.0.vsix`
Location: `C:\Users\mohan\Downloads\vscode-extension\vscode-extension\cnx-agent-0.2.0.vsix`

### Step 2: Install in VS Code

#### Option A: Via VS Code UI (Recommended)
1. Open Visual Studio Code
2. Click on the Extensions icon in the sidebar (or press `Ctrl+Shift+X`)
3. Click the `...` (three dots) menu at the top of the Extensions panel
4. Select "Install from VSIX..."
5. Navigate to and select `cnx-agent-0.2.0.vsix`
6. Click "Install"
7. Reload VS Code when prompted

#### Option B: Via Command Line
```powershell
code --install-extension "C:\Users\mohan\Downloads\vscode-extension\vscode-extension\cnx-agent-0.2.0.vsix"
```

### Step 3: Configure API Keys
1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "Cnx"
3. Configure your AI provider:
   - **OpenAI**: Set `cnx.openaiApiKey` and optionally `cnx.openaiBaseUrl`
   - **Gemini**: Set `cnx.geminiApiKey`
   - **Anthropic**: Set `cnx.anthropicApiKey`
4. Select your preferred provider in `cnx.aiProvider`

---

## ✨ New Feature: Self-Healing (Autonomous Error Fixing)

### What is Self-Healing?
The extension now includes an **autonomous error detection and fixing system** that:
- 🔍 **Monitors your workspace in real-time** for TypeScript, build, and linting errors
- 🤖 **Automatically analyzes errors** using AI
- 🔧 **Generates and applies fixes** without manual intervention
- 📊 **Tracks fix history** for transparency

### How It Works
1. **Automatic Detection**: When you save a file or compile your code, the extension detects errors via VS Code diagnostics
2. **AI Analysis**: Errors are sent to the AI service for intelligent analysis
3. **Code Generation**: The AI generates fixed code based on the error context
4. **Auto-Apply**: The fix is automatically applied to your files
5. **Notification**: You're notified of successful fixes

### Using Self-Healing

#### Status Bar Indicator
Look for the **"🔧 Self-Healing: ON"** indicator in the bottom-right status bar:
- **Green/ON**: Autonomous fixing is active
- **Gray/OFF**: Autonomous fixing is disabled
- Click to toggle on/off

#### Commands (Access via Command Palette `Ctrl+Shift+P`)

1. **Toggle Self-Healing (Auto Error Fix)**
   - Enables/disables automatic error fixing
   - Shortcut: Click the status bar item

2. **Scan and Fix Errors Now**
   - Manually trigger a workspace-wide error scan
   - Attempts to fix all detected errors immediately
   - Useful for batch fixing after pulling changes

3. **View Self-Healing Fix History**
   - Shows a list of all automatically applied fixes
   - Includes file names and fix descriptions
   - Helps track what the extension has changed

### Example Workflow

```
1. You write code with a TypeScript error
2. Save the file (Ctrl+S)
3. Extension detects the error automatically
4. AI analyzes: "Property 'createdAt' does not exist on type 'AgentInstance'"
5. AI generates fix: Replace 'createdAt' with 'startedAt'
6. Fix is applied automatically
7. You see: "✅ Successfully fixed 1 error(s) in AgentManagerPanel.ts"
8. Continue coding!
```

---

## 🎯 Core Features

### 1. Agent Manager (Mission Control)
- **Open**: `Ctrl+Shift+M` or Command Palette → "Open Agent Manager"
- Spawn and manage multiple AI agents simultaneously
- Real-time monitoring of agent progress
- View artifacts, logs, and feedback

### 2. Spawn New Agent
- **Shortcut**: `Ctrl+Shift+N`
- **Command**: "Spawn New Agent"
- Create autonomous agents for specific tasks
- Choose execution mode: Autopilot, Review, or Assisted

### 3. Development Modes
- **Autopilot**: Full autonomy - agents execute without asking
- **Review**: Maximum control - approval required for most actions
- **Assisted** (Default): Balanced - safe actions auto-execute

### 4. Browser Testing
- **Command**: "Run Browser Test"
- Automated browser testing with Playwright
- Screenshot capture and test reporting

### 5. Chat Interface
- **Shortcut**: `Ctrl+L` to activate chat
- **Shortcut**: `Ctrl+Shift+A` to open chat sidebar
- Interactive AI assistant for coding tasks

---

## ⚙️ Configuration Options

### Essential Settings
```json
{
  "cnx.aiProvider": "openai",           // or "gemini", "anthropic"
  "cnx.openaiApiKey": "your-key-here",
  "cnx.model": "gpt-4o",
  "cnx.developmentMode": "assisted",     // or "autopilot", "review"
  "cnx.maxConcurrentAgents": 5
}
```

### Self-Healing Settings
The self-healing feature is enabled by default and works automatically. No additional configuration needed!

---

## 🔑 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+L` | Activate Chat |
| `Ctrl+Shift+A` | Open Chat Sidebar |
| `Ctrl+Shift+M` | Open Agent Manager |
| `Ctrl+Shift+N` | Spawn New Agent |
| `Ctrl+E` | Toggle Editor/Agent Manager |

---

## 🐛 Troubleshooting

### Extension Not Loading
1. Check VS Code version (requires 1.85.0+)
2. Reload window: `Ctrl+Shift+P` → "Reload Window"
3. Check Output panel: View → Output → Select "Cnx Agent"

### Self-Healing Not Working
1. Ensure an AI provider is configured with valid API key
2. Check the status bar - should show "Self-Healing: ON"
3. Verify errors are TypeScript/build errors (not runtime errors)
4. Check Output panel for error messages

### API Key Issues
1. Verify API key is correct in settings
2. Check API provider status (OpenAI, Gemini, etc.)
3. Ensure you have API credits/quota available

### Performance Issues
1. Reduce `cnx.maxConcurrentAgents` to 2-3
2. Disable self-healing if not needed
3. Clear agent history: Command Palette → "Clear Conversation History"

---

## 📊 Monitoring Self-Healing Activity

### View Logs
1. Open Output panel: View → Output
2. Select "Cnx Agent" from dropdown
3. Watch for error detection and fix messages

### Check Fix History
1. Command Palette (`Ctrl+Shift+P`)
2. Type "View Self-Healing Fix History"
3. See all applied fixes with timestamps

---

## 🎓 Best Practices

### For Self-Healing
1. **Review fixes periodically**: Check the fix history to understand what was changed
2. **Use version control**: Always commit before major changes so you can revert if needed
3. **Start with small files**: Let the system learn your codebase gradually
4. **Disable for critical files**: Turn off self-healing when working on production-critical code

### For Agent Management
1. **Name your agents**: Give descriptive names for easy tracking
2. **Monitor progress**: Keep Agent Manager open to watch agent activity
3. **Use appropriate modes**: Autopilot for routine tasks, Review for critical changes

---

## 🆘 Support & Feedback

### Getting Help
- Check the Output panel for detailed logs
- Review the fix history for self-healing issues
- Ensure your AI provider is properly configured

### Reporting Issues
When reporting issues, include:
1. VS Code version
2. Extension version (0.2.0)
3. AI provider and model being used
4. Error messages from Output panel
5. Steps to reproduce

---

## 🎉 You're Ready!

The extension is now installed with **autonomous error-fixing capabilities**. Start coding, and let the AI handle the errors automatically!

**Quick Start:**
1. Open a TypeScript project
2. Write some code
3. Watch as errors are detected and fixed automatically
4. Check the status bar for self-healing status
5. Use `Ctrl+Shift+M` to open Mission Control

Happy coding! 🚀
