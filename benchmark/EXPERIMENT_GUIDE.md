# OptiVault × Caveman — Benchmark Experiment Guide

Controlled experiment to measure the token, time, and cost impact of
**OptiVault** (AST input compression) and **Caveman** (output compression)
across four scenarios using the same task prompt against the same codebase.

---

## The Task Prompt (identical across all runs)

> "Find the authentication middleware and add a mock rate-limiting check
> that returns HTTP 429 if the user exceeds the limit."

---

## Target Codebase

Clone any mid-sized REST API template (20–50 source files). A good choice:

```bash
git clone https://github.com/hagopj13/node-express-boilerplate target-repo
cd target-repo
```

Avoid large monorepos — you want a codebase where Baseline costs roughly
$0.10–$0.20 per run so the contrast is visible.

---

## Before You Start

1. **Record your Claude Code plan** — check `~/.claude.json` and note which
   MCP servers are registered. You will enable/disable them per scenario.
2. **Note your model** — costs differ between Opus and Sonnet. Use the same
   model for all four runs.
3. **Cost reference** (Sonnet 3.5 as of mid-2025):
   - Input:  $3.00 / 1M tokens
   - Output: $15.00 / 1M tokens
   You can derive `Cost_Cents` yourself or read it from `/cost`.

---

## Scenario 1 — Baseline (Vanilla Claude)

**Setup:** No OptiVault. No Caveman. Standard file reading via `cat`/`grep`.

```bash
# 1. Remove OptiVault MCP registration (if present):
claude mcp remove optivault

# 2. Open Claude Code in the target repo:
cd target-repo
claude

# 3. Clear context to start at 0 tokens:
/clear

# 4. Run the task prompt:
Find the authentication middleware and add a mock rate-limiting check
that returns HTTP 429 if the user exceeds the limit.

# 5. After Claude finishes, check cost:
/cost
```

**Record in data.csv:**
- `Input_Tokens`  — from `/cost` output
- `Output_Tokens` — from `/cost` output
- `Time_Seconds`  — wall-clock seconds from prompt submission to final response
- `Cost_Cents`    — from `/cost` (convert to cents)

---

## Scenario 2 — Caveman Only

**Setup:** Caveman active. OptiVault off.

Caveman compresses Claude's *output* into a dense, token-efficient format.
Install/enable it per its own README, then:

```bash
# Ensure OptiVault is still removed:
claude mcp remove optivault   # (no-op if already absent)

# Clear context:
/clear

# Run the same prompt:
Find the authentication middleware and add a mock rate-limiting check
that returns HTTP 429 if the user exceeds the limit.

/cost
```

You should see input tokens roughly equal to Baseline (same file reading),
but output tokens significantly lower (Caveman compression).

---

## Scenario 3 — OptiVault Only

**Setup:** OptiVault active. Caveman off/uninstalled.

```bash
# 1. Index the target repo:
optivault init .

# 2. Register the MCP server:
claude mcp add optivault optivault -- mcp \
  --vault ./_optivault \
  --source .

# 3. Disable Caveman (per its own docs).

# 4. Open Claude Code and clear context:
/clear

# 5. Run the same prompt — Claude will use read_repo_map and
#    read_file_skeleton instead of raw file reads:
Find the authentication middleware and add a mock rate-limiting check
that returns HTTP 429 if the user exceeds the limit.

/cost
```

You should see a dramatic drop in input tokens (AST skeletons vs. full files)
while output tokens stay roughly the same as Baseline.

---

## Scenario 4 — God Mode (OptiVault + Caveman)

**Setup:** Both OptiVault and Caveman active simultaneously.

```bash
# OptiVault should already be registered from Scenario 3.
# Re-enable Caveman.

/clear

Find the authentication middleware and add a mock rate-limiting check
that returns HTTP 429 if the user exceeds the limit.

/cost
```

This should show the lowest tokens, fastest time, and cheapest cost of all
four scenarios.

---

## Filling in data.csv

Open `benchmark/data.csv` and replace the mock numbers with your real
measurements:

```csv
Scenario,Input_Tokens,Output_Tokens,Total_Tokens,Time_Seconds,Cost_Cents
Baseline,<your_value>,<your_value>,<your_value>,<your_value>,<your_value>
Caveman Only,...
OptiVault Only,...
OptiVault + Caveman,...
```

`Total_Tokens = Input_Tokens + Output_Tokens`

---

## Generating the Charts

```bash
# Install Python dependencies (one-time):
pip install -r benchmark/requirements.txt

# Generate all four charts:
python benchmark/plot_results.py
```

Output PNGs are written to `benchmark/results/`:

| File | Use |
|---|---|
| `chart1_token_consumption.png` | Stacked Input/Output bar chart |
| `chart2_execution_speed.png` | Time-to-completion bars |
| `chart3_cost_per_task.png` | Cost per task in USD |
| `chart4_hero_card.png` | 2×2 composite — best for Twitter/LinkedIn |

---

## Posting on Social Media

### Twitter / X
- Lead with `chart4_hero_card.png`
- Caption template:
  > "We ran the exact same coding task 4 ways in Claude Code.
  > OptiVault + Caveman: ⬇ 94% tokens, 🚀 9× faster, ⬇ 95% cheaper.
  > Zero LLMs. Zero API calls. Pure AST compression.
  > github.com/your-username/optivault  #ClaudeCode #AI #DevTools"

### Reddit (r/LocalLLaMA, r/ClaudeAI)
- Post all four charts in an album
- Include the raw numbers table in the post body
- Link the repo + explain the methodology

### LinkedIn
- Use `chart4_hero_card.png` as the hero image
- Write a short technical breakdown (2–3 paragraphs) explaining what each
  scenario does before showing the numbers

---

## Fairness Checklist

- [ ] Same model used across all four runs
- [ ] `/clear` run before every scenario (0 carry-over context)
- [ ] Same target codebase, same prompt wording
- [ ] No manual file reads injected outside the scenario's tool config
- [ ] Time measured from prompt submission to last token received
- [ ] Cost read from `/cost` immediately after the run, before `/clear`
