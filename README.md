# Cnx Agent VS Code Extension

Cnx Agent is a powerful, autonomous AI coding assistant integrated directly into VS Code. It goes beyond simple chat by actively interacting with your workspace—reading files, running terminal commands, managing your token budget, and even self-healing your code.

## 🌟 Key Features

1. **Multi-Model Support (Cloud & Local)**
   * Seamlessly switch between OpenAI (GPT-4o), Anthropic (Claude 3.5), Google (Gemini 2.0), and **Local Models via Ollama**.
   * Completely private local coding using models like `llama3.2` or `qwen2.5-coder`.
2. **Autonomous Tool Execution**
   * The agent can read files, search directories, and run terminal commands (like npm scripts or git commands) on your behalf.
   * Safe execution: Dangerous terminal commands require your explicit approval.
3. **Self-Healing Code**
   * Continuously monitors your workspace for TypeScript/Lint errors.
   * When an error is detected, the agent analyzes it in the background and silently fixes the file for you.
4. **Context Aware**
   * Automatically knows what files you have open and what code you have highlighted.

---

## 🚀 Getting Started

### 1. Installation
Install the extension via the provided `.vsix` package:
1. Open VS Code.
2. Go to the Extensions view (`Ctrl+Shift+X`).
3. Click the `...` menu in the top right → **Install from VSIX...**
4. Select `cnx-agent-v1.vsix`.

### 2. Configuration (Settings)
You need to configure an AI provider and API key for the extension to communicate with cloud models. 

**How to find the settings:**
1. Open VS Code Settings (`Ctrl+,` on Windows/Linux, `Cmd+,` on Mac).
2. Search for `Cnx`.
3. Alternatively, open your `settings.json` file directly:
   * Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) to open the Command Palette.
   * Type **`Open Settings (JSON)`** and select **Preferences: Open User Settings (JSON)**.

You have two options for models:

**Option A: Cloud Models (Requires API Keys)**
You can set your keys either in the VS Code Settings UI or directly in `settings.json`:

```json
{
  "cnx.aiProvider": "openai",       // Options: "openai", "gemini", "anthropic"
  "cnx.openaiApiKey": "sk-...",     // Your OpenAI API key
  "cnx.geminiApiKey": "AIza...",    // Your Google Gemini API key
  "cnx.anthropicApiKey": "sk-ant..." // Your Anthropic Claude API key
}
```

*Note: You can also use environment variables instead of VS Code settings! Just set `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY` on your machine, and the extension will automatically pick them up.*

**Option B: Local Models (Free & Private)**
* Install [Ollama](https://ollama.com/) on your machine.
* Open a terminal and pull a model: `ollama pull qwen2.5-coder:7b`
* Ensure Ollama is running (`ollama serve`).
* In the extension, open the model dropdown—you will see a **🏠 LOCAL (OLLAMA)** section. Select your local model!

---

## 💻 How to Use It

### The Chat Panel
Click the **Cnx icon** in the activity bar to open the chat panel. 

1. **Model Switcher:** Use the dropdown at the top of the chat to switch between Cloud and Local models instantly.
2. **Asking Questions:** Just ask! "Explain this file", "Write a react component for a login form", or "Find where we define the User interface".
3. **Terminal Commands:** Ask the agent to "Run the test suite" or "Start the dev server". It will propose the command and wait for your approval.

### The Self-Healing Service
By default, Cnx Agent watches your code for errors.
* If you make a syntax mistake in a `.ts` file, a background process will attempt to fix it using AI.
* A notification will pop up saying `✅ Self-Healed: Fixed X error(s) in filename.ts`.
* *Note:* Configuration files like `tsconfig.json` and `package.json` are strictly ignored by the self-healing service to prevent accidental environment changes.
* You can toggle this feature on/off by clicking `$(tools) Self-Healing: ON` in the bottom status bar.

### Managing Token Budgets
* The extension automatically tracks your conversation context limit.
* You can see your budget status (e.g., `Budget: 45%`) in the UI.
* If you exceed the context window of the selected model, the agent will automatically prune older messages to keep the conversation flowing smoothly.

---

## 🛠️ Architecture & Under the Hood

The extension is built with a modular architecture:
* **`AgentCore`**: The brain. Manages the conversation loop, tool execution, and context.
* **`ModelRegistry`**: Dynamically probes your environment (env vars, settings, local ports) to build the list of available models.
* **`SelfHealingService`**: Hooks into VS Code's diagnostic engine to detect errors and issue autonomous fix commands.
* **`AIService`**: The routing layer that normalizes API requests across OpenAI, Anthropic, Gemini, and local Ollama instances.

## 🤝 Support
If a local model isn't showing up, ensure Ollama is running (`curl http://localhost:11434` should return `Ollama is running`).
