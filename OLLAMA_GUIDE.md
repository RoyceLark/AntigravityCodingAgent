# Cnx Agent — Ollama & Local Model Support Guide

## How the Extension was Built

The extension now supports **5 AI providers** in one unified interface:

| Provider | Needs API Key | Notes |
|----------|:---:|-------|
| `openai` | ✅ | GPT-4o, o1, GPT-3.5 |
| `openai-compatible` | ✅ | LiteLLM, vLLM, LocalAI, any OpenAI-compatible gateway |
| `gemini` | ✅ | Gemini 2.0 Flash, 1.5 Pro |
| `anthropic` | ✅ | Claude Opus, Sonnet, Haiku |
| **`ollama`** | ❌ | **Free, local, private — runs on your machine** |

---

## Step 1 — Install Ollama

> [!IMPORTANT]
> Ollama must be installed and running BEFORE loading models in the extension.

### Windows
```powershell
# Option A: Download installer
# Go to: https://ollama.com/download
# Click "Download for Windows" → run OllamaSetup.exe

# Option B: winget
winget install Ollama.Ollama
```

### macOS
```bash
brew install ollama
```

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

After installing, Ollama starts automatically and listens on `http://localhost:11434`.
Verify it's running:
```bash
ollama --version
# or open: http://localhost:11434 in browser
```

---

## Step 2 — Pull a Local Model

Choose a model based on your hardware:

| Model | Size | Best For | Pull Command |
|-------|------|----------|-------------|
| `llama3.2:1b` | ~1 GB | Very fast, low RAM | `ollama pull llama3.2:1b` |
| `llama3.2:3b` | ~2 GB | Good balance | `ollama pull llama3.2` |
| `qwen2.5-coder:7b` | ~4 GB | **Best for coding** ⭐ | `ollama pull qwen2.5-coder:7b` |
| `llama3.1:8b` | ~5 GB | General purpose | `ollama pull llama3.1` |
| `mistral:7b` | ~4 GB | Fast, tool calling | `ollama pull mistral` |
| `deepseek-coder-v2` | ~9 GB | Advanced coding | `ollama pull deepseek-coder-v2` |
| `qwen2.5-coder:14b` | ~9 GB | High quality coding | `ollama pull qwen2.5-coder:14b` |

```powershell
# Recommended starter (good coding model, ~4 GB)
ollama pull qwen2.5-coder:7b

# Check what you have
ollama list
```

---

## Step 3 — Configure the Extension

### Method A: Command Palette (Easiest) ⭐

1. Press **`Ctrl+Shift+P`** to open the Command Palette
2. Type: **`Cnx: List & Switch Ollama Models`**
3. A picker shows all your pulled models with sizes
4. Select one — the extension automatically switches to Ollama

### Method B: VS Code Settings UI

1. Press **`Ctrl+,`** → search for **`cnx`**
2. Set **`Cnx: Ai Provider`** → `ollama`
3. Set **`Cnx: Model`** → e.g., `qwen2.5-coder:7b`
4. Optionally set **`Cnx: Ollama Base Url`** if running on a remote machine

### Method C: Settings JSON

```json
{
  "cnx.aiProvider": "ollama",
  "cnx.model": "qwen2.5-coder:7b",
  "cnx.ollamaBaseUrl": "http://localhost:11434",
  "cnx.ollamaRequestTimeout": 120000
}
```

---

## Step 4 — Verify It's Working

After selecting a model, open the Cnx Agent chat panel (**`Ctrl+Shift+A`**) and type:

```
Who are you and what model are you?
```

If Ollama is working, you'll see a streaming response from the local model. The status bar briefly shows:

```
$(server-process) Ollama: 3 model(s) ready
```

---

## How Tool Calling Works with Local Models

The extension automatically detects whether your model supports **native tool calling**:

### Models with Native Tool Calling ✅
These models can use all 40+ Cnx Agent tools (file editing, terminal, search, etc.) natively:
- `llama3.1`, `llama3.2`, `llama3.3`
- `qwen2`, `qwen2.5`, `qwen2.5-coder`
- `mistral-nemo`, `mistral-small`
- `command-r`, `command-r-plus`
- `hermes3`, `firefunction-v2`

### Models WITHOUT Native Tool Calling (JSON-mode emulation) ⚠️
For these models, the extension automatically falls back to **JSON-mode emulation** — it injects tool schemas as instructions in the system prompt and parses tool calls from the model's text output. This works but is slower and less reliable:
- `phi3`, `gemma`, `stablelm`, older models

> [!TIP]
> For best agentic performance with local models, use **`qwen2.5-coder:7b`** or **`llama3.1:8b`** — both have excellent native tool calling.

---

## Remote Ollama (Another Machine / Server)

If Ollama runs on another computer or a GPU server:

```json
{
  "cnx.aiProvider": "ollama",
  "cnx.ollamaBaseUrl": "http://192.168.1.100:11434",
  "cnx.model": "qwen2.5-coder:14b"
}
```

On the server, set the environment variable to allow remote connections:
```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

---

## New Command Reference

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Cnx: List & Switch Ollama Models` | Command Palette | Live picker of all pulled models |
| `Cnx: Open Settings` | Command Palette | Jump to Cnx settings |
| `Cnx: Open Agent Chat` | `Ctrl+Shift+A` | Open the AI chat |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot reach Ollama at localhost:11434" | Run `ollama serve` in terminal |
| Model picker is empty | Run `ollama pull <model>` first |
| Very slow responses | Use a smaller model (1b or 3b) or enable GPU |
| Tool calls not working | Switch to `llama3.1` or `qwen2.5-coder` |
| Running on remote machine | Set `cnx.ollamaBaseUrl` to the remote IP |

---

## Architecture Summary

```
VS Code Extension (Cnx Agent)
│
├── AIService.ts          ← Provider router (new)
│   ├── → OpenAI SDK     (GPT-4o, custom gateways)
│   ├── → Gemini SDK     (Google AI)
│   ├── → Anthropic SDK  (Claude)
│   └── → OllamaService  (local models)  ← NEW
│
├── OllamaService.ts      ← Ollama REST client (new)
│   ├── healthCheck()     /api/version
│   ├── listModels()      /api/tags
│   ├── chatCompletion()  /api/chat (streaming NDJSON)
│   ├── Native tools      → llama3.1+, qwen2.5, mistral...
│   └── JSON emulation    → fallback for older models
│
└── ModelRegistry.ts      ← Unified model discovery (new)
    ├── fetchProviderStatus('ollama')   → live discovery
    ├── fetchProviderStatus('openai')   → static list
    ├── fetchProviderStatus('gemini')   → static list
    └── fetchProviderStatus('anthropic') → static list
```
