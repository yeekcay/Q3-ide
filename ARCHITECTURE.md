# QwenCodeIDE — Architecture & Project Plan

## 1. Vision

A standalone, heavily modified VS Code fork with a deeply integrated offline AI agent powered by Qwen 3 Coder. No cloud dependencies. All inference runs locally.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    QwenCodeIDE (Electron App)              │
│                                                            │
│  ┌────────────────┐    ┌───────────────────────────────┐  │
│  │  Editor Shell   │    │        Agent System            │  │
│  │  (VS Code fork) │    │                                │  │
│  │                  │    │  ┌──────────┐  ┌───────────┐  │  │
│  │  - Monaco editor │◄──►│  │  Agent   │  │  Tool     │  │  │
│  │  - File explorer │    │  │  Core    │──│  Router   │  │  │
│  │  - Terminal      │    │  │          │  └───────────┘  │  │
│  │  - Git panel     │    │  │  Prompt  │  ┌───────────┐  │  │
│  │  - Settings      │    │  │  Builder │──│  Context  │  │  │
│  │  - Agent panel   │    │  │          │  │  Builder  │  │  │
│  │   (native)       │    │  └──────────┘  └───────────┘  │  │
│  │                  │    │       │                        │  │
│  └────────────────┘    │       ▼                        │  │
│                          │  ┌──────────────────────────┐  │  │
│                          │  │   LLM Bridge (IPC/HTTP)  │  │  │
│                          │  └──────────────────────────┘  │  │
│                          └───────────┬────────────────────┘  │
│                                       │                      │
│                          ┌────────────▼───────────────────┐  │
│                          │    Local Inference Engine       │  │
│                          │    (Ollama / llama.cpp)         │  │
│                          │    - Qwen 3 Coder (GGUF)        │  │
│                          │    - GPU accel (CUDA/Vulkan)    │  │
│                          └─────────────────────────────────┘  │
│                                                            │
│  Electron Main Process (lifecycle, IPC, child processes)   │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Component Breakdown

### 3.1 Editor Shell (VS Code Fork)

| Component | Description | Location (VS Code source) |
|-----------|-------------|---------------------------|
| Branding | App name, icons, splash, about dialog | `product.json`, `resources/` |
| Agent Panel | Native view container in activity bar | `src/vs/workbench/contrib/agent/` (new) |
| Inline Completions | Qwen-powered ghost text | `src/vs/editor/contrib/inlineCompletions/` |
| Editor Hooks | Cursor, selection, file-open events | `src/vs/workbench/services/agent/` (new) |
| Settings UI | Model config, hardware, agent behavior | `src/vs/workbench/contrib/agent/browser/` |
| Terminal Bridge | Agent can run commands, read output | `src/vs/workbench/contrib/terminal/` |
| Diagnostics Feed | Agent reads Problems panel | `src/vs/workbench/contrib/markers/` |

### 3.2 Agent System

#### Agent Core
- Orchestrates the agent loop: receive request → build context → call LLM → parse response → execute tools → feed results back → repeat.
- Manages conversation history and session state.
- Implements stop/cancel for long-running agentic loops.

#### Prompt Builder
- Constructs the system prompt (agent identity, capabilities, rules).
- Injects editor context: active file, selection, cursor position, language, open tabs.
- Manages context window budget — truncates/summarizes when context exceeds model limits.

#### Context Builder
- Gathers workspace context: file tree, git status, recent edits, diagnostics.
- Provides tools to the agent: read_file, grep_search, list_dir, run_command, apply_edit, git operations.
- Respects file size limits and ignores (e.g., node_modules, .git).

#### Tool Router
- Maps LLM tool-call requests to actual editor operations.
- Sandboxes file writes (requires user approval for destructive ops).
- Streams tool execution results back to the LLM for multi-step reasoning.

### 3.3 LLM Bridge

- Abstracts the inference engine behind a common interface.
- Supports pluggable backends: Ollama, llama.cpp server, or embedded llama.cpp via Node bindings.
- Handles: model loading, prompt formatting (chat template), streaming token generation, cancellation.
- Runs as a managed child process spawned by the Electron main process.

### 3.4 Local Inference Engine

**Primary: Ollama**
- Simple HTTP API (`localhost:11434`).
- Handles model pulling, quantization, GPU detection automatically.
- Supports streaming via SSE.
- Qwen 3 Coder available as `ollama pull qwen3-coder`.

**Alternative: llama.cpp**
- Lower-level, more control over quantization and GPU backend.
- Can run as a server (`llama-server`) or be embedded via `node-llama-cpp`.
- Better for custom builds with specific GPU support (CUDA, Vulkan, Metal).

### 3.5 Model Management

- First-run wizard: detect GPU, recommend model size, download GGUF.
- Model selector in settings: switch between models (e.g., 4B, 8B, 14B depending on VRAM).
- VRAM/RAM monitor in status bar.
- Auto-unload model after idle period to free memory.

---

## 4. Data Flow

### 4.1 Chat Request

```
1. User types in Agent Panel: "Refactor this function to use async/await"
2. Agent Panel → postMessage → Agent Core
3. Context Builder gathers:
   - Active file content + cursor position
   - Language ID (typescript, python, etc.)
   - Open tabs list
   - Git diff (if any)
4. Prompt Builder assembles:
   [system_prompt] + [context] + [conversation_history] + [user_message]
5. LLM Bridge sends to inference engine (streaming)
6. Agent Core receives tokens, streams to Agent Panel
7. If LLM emits a tool call (e.g., apply_edit):
   - Tool Router executes the edit
   - Result fed back to LLM for continuation
   - Loop until LLM signals completion
8. Agent Panel renders final response with code blocks + "Apply" buttons
```

### 4.2 Inline Completion

```
1. User pauses typing (debounce 300ms)
2. Editor hooks → Context Builder (current line, surrounding context)
3. Prompt Builder → fill-in-the-middle prompt
4. LLM Bridge → inference engine (single completion, no streaming)
5. Result → InlineCompletionsProvider → ghost text rendered
6. User accepts (Tab) or rejects (Esc)
```

### 4.3 Agentic Multi-Step

```
1. User: "Fix the failing tests"
2. Agent Core → LLM: "I'll start by running the tests"
3. Tool Router → run_command("npm test")
4. Tool Router captures output → feeds back to LLM
5. LLM: "Test X fails because of Y. Let me read the file."
6. Tool Router → read_file("src/foo.ts")
7. LLM: "The bug is on line 42. Applying fix."
8. Tool Router → apply_edit("src/foo.ts", old_string, new_string)
9. LLM: "Re-running tests to verify."
10. Tool Router → run_command("npm test")
11. LLM: "All tests pass. Done."
```

---

## 5. Project Structure

```
QwenCodeIDE/
├── .vscode/                        # VS Code build configs
├── build/                          # Build scripts (gulp, electron builder)
├── extensions/                     # Built-in extensions (from VS Code)
├── product.json                    # Custom branding config
├── resources/                      # App icons, splash, installer assets
│   ├── icons/
│   └── splash/
├── src/
│   ├── vs/
│   │   ├── workbench/
│   │   │   ├── contrib/
│   │   │   │   └── agent/          # NEW: Agent panel & UI
│   │   │   │       ├── browser/
│   │   │   │       │   ├── agentPanel.ts
│   │   │   │       │   ├── agentView.ts
│   │   │   │       │   └── media/
│   │   │   │       │       ├── agent.css
│   │   │   │       │       └── agent.js
│   │   │   │       └── common/
│   │   │   │           └── agentConfig.ts
│   │   │   └── services/
│   │   │       └── agent/          # NEW: Agent core services
│   │   │           ├── agentCore.ts
│   │   │           ├── promptBuilder.ts
│   │   │           ├── contextBuilder.ts
│   │   │           ├── toolRouter.ts
│   │   │           └── llmBridge.ts
│   │   └── editor/
│   │       └── contrib/
│   │           └── inlineCompletions/
│   │               └── qwenProvider.ts  # Modified: Qwen inline provider
│   └── platform/                   # Platform-level changes
│       └── agent/
│           └── inferenceEngine.ts  # Child process management
├── package.json                    # VS Code root package.json
├── gulpfile.js                     # Build pipeline
└── ARCHITECTURE.md                 # This document
```

---

## 6. Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Base | VS Code OSS (VSCodium fork) | Telemetry-free, MIT licensed |
| UI Framework | VS Code's native DOM + Monaco | No extra framework, deep integration |
| LLM Engine | Ollama (primary), llama.cpp (fallback) | Ollama is simplest; llama.cpp for advanced users |
| Model Format | GGUF (Q4_K_M quantization default) | Best speed/quality tradeoff for local |
| GPU Backend | Auto-detect: CUDA > Vulkan > Metal > CPU | Maximize performance per platform |
| Agent Protocol | OpenAI-compatible tool calling | Qwen 3 Coder supports function calling |
| Build | VS Code's existing gulp + Electron Builder | Proven pipeline, minimal custom tooling |
| Packaging | Electron Builder | Cross-platform installers (.exe, .dmg, .AppImage) |

---

## 7. Task Breakdown

### Phase 1: Foundation (Weeks 1-2)

- [ ] **1.1** Fork VS Code OSS / VSCodium
- [ ] **1.2** Set up build environment (Node.js, Yarn, Python, VS Build Tools)
- [ ] **1.3** Verify clean build on Windows
- [ ] **1.4** Custom branding: app name, icons, product.json
- [ ] **1.5** First successful packaged build (`.exe`)

### Phase 2: LLM Integration (Weeks 3-4)

- [ ] **2.1** Implement `inferenceEngine.ts` — child process management for Ollama
- [ ] **2.2** Implement `llmBridge.ts` — HTTP client, streaming, cancellation
- [ ] **2.3** Implement model management: first-run wizard, settings, auto-download
- [ ] **2.4** Implement `promptBuilder.ts` — system prompt + context assembly
- [ ] **2.5** Validate: send a prompt to Qwen 3 Coder, receive streamed response

### Phase 3: Agent Panel UI (Weeks 5-6)

- [ ] **3.1** Create agent view container in activity bar
- [ ] **3.2** Build chat UI (message list, input box, send button)
- [ ] **3.3** Implement streaming token rendering with syntax highlighting
- [ ] **3.4** Add "Apply" buttons for code blocks
- [ ] **3.5** Add conversation history and session management
- [ ] **3.6** Add stop/cancel button for agent loops

### Phase 4: Context & Tools (Weeks 7-8)

- [ ] **4.1** Implement `contextBuilder.ts` — active file, selection, cursor, tabs
- [ ] **4.2** Implement `toolRouter.ts` — tool dispatch system
- [ ] **4.3** Tools: `read_file`, `list_dir`, `grep_search`, `apply_edit`
- [ ] **4.4** Tools: `run_command` (terminal bridge), `git_status`, `git_commit`
- [ ] **4.5** Tools: `read_diagnostics` (Problems panel)
- [ ] **4.6** User approval flow for destructive operations
- [ ] **4.7** Context window budget management (truncation/summarization)

### Phase 5: Inline Completions (Week 9)

- [ ] **5.1** Modify inline completions provider to use Qwen
- [ ] **5.2** Implement FIM (fill-in-the-middle) prompt format
- [ ] **5.3** Debounce and caching for completions
- [ ] **5.4** Settings: enable/disable, trigger delay, max tokens

### Phase 6: Agentic Loop (Weeks 10-11)

- [ ] **6.1** Implement multi-step agent loop in `agentCore.ts`
- [ ] **6.2** Tool call parsing from LLM output (function calling format)
- [ ] **6.3** Result feedback to LLM for continuation
- [ ] **6.4** Progress indicators during multi-step execution
- [ ] **6.5** Error handling and retry logic
- [ ] **6.6** Token usage tracking and display

### Phase 7: Polish & Distribution (Weeks 12-13)

- [ ] **7.1** Status bar: model name, VRAM usage, inference status
- [ ] **7.2** Keyboard shortcuts for agent interactions
- [ ] **7.3** Settings page: model selection, temperature, max tokens, GPU backend
- [ ] **7.4** Auto-update mechanism (for the IDE itself, not models)
- [ ] **7.5** Cross-platform testing (Windows, macOS, Linux)
- [ ] **7.6** Installer packaging (.exe, .dmg, .AppImage)
- [ ] **7.7** Documentation: README, user guide, build instructions

---

## 8. Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| VS Code build complexity | High | Start from VSCodium which simplifies the build; document every step |
| Model size vs. performance | Medium | Default to Q4_K_M quantization; offer multiple model sizes; auto-detect VRAM |
| Context window limits | Medium | Implement smart truncation; prioritize active file + recent context |
| Inference latency | Medium | Stream tokens; use smaller model for inline completions; cache results |
| Upstream VS Code updates | Low | Pin to a specific VS Code version; rebase periodically |
| GPU driver issues | Medium | Auto-detect + fallback to CPU; clear error messages |

---

## 9. Configuration Schema (Preview)

```json
{
  "qwen.agent.model": "qwen3-coder:8b",
  "qwen.agent.endpoint": "http://localhost:11434",
  "qwen.agent.temperature": 0.7,
  "qwen.agent.maxTokens": 4096,
  "qwen.agent.contextWindow": 32768,
  "qwen.agent.gpuBackend": "auto",
  "qwen.agent.inlineCompletions": true,
  "qwen.agent.inlineDebounce": 300,
  "qwen.agent.autoApproveReads": true,
  "qwen.agent.autoApproveEdits": false,
  "qwen.agent.autoApproveCommands": false,
  "qwen.agent.maxLoopSteps": 20
}
```

---

## 10. Confirmed Decisions

| Decision | Choice | Confirmed |
|----------|--------|-----------|
| Base | VSCodium fork (Option A) | ✅ |
| LLM Engine | Ollama (primary) | ✅ |
| GitHub Repo | https://github.com/yeekcay/Q3-ide | ✅ |
| Model | Qwen 3 Coder (GGUF, Q4_K_M) | ✅ |

## 11. Next Steps

1. ~~Confirm technology choices~~ ✅
2. Set up the development environment
3. Clone VSCodium as the base fork
4. Apply custom branding
5. Begin Phase 1 tasks
