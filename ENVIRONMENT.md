# Environment Setup for Repro

## Prerequisites

The following software must be installed before building and running Repro:

### Core Requirements

- **Node.js 18+** - Required for npm install, MCP servers, and hooks via npx
  - Install from https://nodejs.org/
  - Verify: `node --version`

- **Claude Code** - The build tool for Repro
  - Install: `npm install -g @anthropic-ai/claude-code`
  - Or native binary: `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux/WSL)
  - Verify: `claude doctor`

- **Git 2.23+** - For cloning, branching, and PR-based workflows
  - Verify: `git --version`

### Development Account Requirements

- **claude.ai account (Pro or Max tier)** - Required for Claude Code authentication
  - Authenticates Claude Code and enables Routines/Dispatch
  - Console API key alone is insufficient for these features

- **Gemini API key** - For model-based reasoning in Diagnose, Repair, and Challenger stages
  - Create in Google AI Studio: https://aistudio.google.com/
  - Export as environment variable: `export GEMINI_API_KEY=<your-key>`
  - For the demo host: use a billing-linked project key
  - For development: free-tier keys are fine (check Google's terms for your use case)

### Optional but Recommended

- **GitHub CLI (`gh`)** - For efficient PR/issue management from the terminal
  - Install from https://cli.github.com/
  - Set up SSH or HTTPS credentials for GitHub

- **Semgrep** - Static analysis scanner (wrapped by Lane 2)
  - Install: `npm install -g semgrep`
  - Or: `brew install semgrep` (macOS)

- **gitleaks** - Secret detection scanner (wrapped by Lane 2)
  - Install: https://github.com/gitleaks/gitleaks#installing
  - Or: `brew install gitleaks` (macOS)

- **Docker Desktop** (or Docker Engine on Linux) - For sandboxed code execution
  - Required for safety (section 9 of CLAUDE.md)
  - Install from https://www.docker.com/

- **WSL2** (Windows only) - Run Claude Code inside WSL rather than PowerShell/cmd
  - Install from Microsoft Store or `wsl --install`

## Environment Variables

### For All Developers

```bash
# Git configuration (done once)
git config user.name "Your Name"
git config user.email "your.email@example.com"

# Gemini API (required for running the product)
export GEMINI_API_KEY=<your-gemini-api-key>

# MongoDB Atlas (set by Lane 1, used by all)
export MONGODB_URI=<shared-connection-string>
```

### For Dispatch and Routines (Remote Supervision)

1. Authenticate Claude Code:
   ```bash
   claude login
   ```

2. Pair Dispatch:
   - Open Cowork on your desktop
   - Enable Dispatch mode
   - Scan the QR code with your phone

### Optional: Model Overrides

These env vars override the defaults specified in CLAUDE.md section 10:

```bash
# Override specific model IDs (defaults below)
export REPRO_MODEL_DIAGNOSE=gemini-3.1-pro-preview
export REPRO_MODEL_CHALLENGER=gemini-3.1-pro-preview
export REPRO_MODEL_REPAIR=gemini-3.8-flash
export REPRO_MODEL_NARRATOR=gemini-3.8-flash
```

## Initial Setup (First Time)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-org/repro.git
   cd repro
   ```

2. **Verify Claude Code:**
   ```bash
   claude doctor
   ```

3. **Install Node dependencies** (once monorepo is set up):
   ```bash
   npm install
   ```

4. **Set environment variables:**
   ```bash
   export GEMINI_API_KEY=<your-key>
   export MONGODB_URI=<shared-connection-string>
   ```

5. **Authenticate for Dispatch** (if you'll be using remote supervision):
   ```bash
   claude login
   # Then pair Dispatch in Cowork
   ```

## Per-Session Setup

Each time you start work on Repro:

```bash
# Activate your lane branch
git checkout lane-1  # (or your assigned lane)

# Ensure environment variables are set
export GEMINI_API_KEY=<your-key>
export MONGODB_URI=<shared-connection-string>

# Keep desktop app awake if using Dispatch
# (see section 6 of CLAUDE.md for details)
```

## Troubleshooting

- **Claude Code auth fails:** Run `claude login` and ensure you're using a Pro/Max claude.ai account, not a Console API key
- **Gemini API 401:** Check that `GEMINI_API_KEY` is set and valid
- **MongoDB connection fails:** Confirm `MONGODB_URI` is correct and your IP is whitelisted in Atlas
- **Docker not found:** Ensure Docker Desktop is running and `docker ps` works
- **Semgrep/gitleaks not found:** Install globally or via `npm` before running detectors

## Rate Limits and Quotas

- **Gemini free tier:** ~60 requests/minute across all models
  - For demo: use a billing-linked key (Tier 1: much higher)
  - For development: share one free key per person or rotate keys
- **MongoDB Atlas free tier:** 512 MB storage, plenty for a hackathon
- **Claude Code usage:** Charged per token to your claude.ai subscription account (not Console)

See section 10 of CLAUDE.md for budgeting details.
