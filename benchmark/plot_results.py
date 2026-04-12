"""
OptiVault x Caveman — Benchmark Visualization Suite
Generates 3 dark-mode, social-media-ready charts from benchmark/data.csv
"""

import os
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(SCRIPT_DIR, "data.csv")
OUT_DIR = os.path.join(SCRIPT_DIR, "results")
os.makedirs(OUT_DIR, exist_ok=True)

df = pd.read_csv(DATA_PATH)

# ---------------------------------------------------------------------------
# Theme
# ---------------------------------------------------------------------------

BG_DARK    = "#0d0f14"
BG_PANEL   = "#13161e"
GRID_COLOR = "#1e2230"
TEXT_COLOR = "#e8eaf0"
LABEL_DIM  = "#6b7280"

# Neon palette per scenario
NEON = {
    "Baseline":          "#ff4d6d",   # neon red
    "Caveman Only":      "#f4a261",   # neon orange
    "OptiVault Only":    "#4cc9f0",   # neon cyan
    "OptiVault + Caveman": "#7b2fff", # neon purple
}

# Stacked chart: input vs output split
INPUT_COLOR  = "#4cc9f0"   # cyan
OUTPUT_COLOR = "#7b2fff"   # purple

plt.rcParams.update({
    "figure.facecolor":  BG_DARK,
    "axes.facecolor":    BG_PANEL,
    "axes.edgecolor":    GRID_COLOR,
    "axes.labelcolor":   TEXT_COLOR,
    "axes.titlecolor":   TEXT_COLOR,
    "axes.titlesize":    17,
    "axes.labelsize":    12,
    "xtick.color":       TEXT_COLOR,
    "ytick.color":       LABEL_DIM,
    "xtick.labelsize":   11,
    "ytick.labelsize":   10,
    "grid.color":        GRID_COLOR,
    "grid.linewidth":    0.6,
    "text.color":        TEXT_COLOR,
    "font.family":       "monospace",
    "legend.facecolor":  BG_PANEL,
    "legend.edgecolor":  GRID_COLOR,
    "legend.labelcolor": TEXT_COLOR,
    "legend.fontsize":   10,
})

scenarios = df["Scenario"].tolist()
x = np.arange(len(scenarios))
BAR_W = 0.55

# ---------------------------------------------------------------------------
# Helper: draw annotation arrow + label
# ---------------------------------------------------------------------------

def annotate_pct_drop(ax, x0, x1, y_base, y_top, label, color="#39d353"):
    """Draw a bracket-style annotation between two bars."""
    mid_x = (x0 + x1) / 2
    ax.annotate(
        "",
        xy=(x1, y_base * 1.02),
        xytext=(x0, y_top * 1.02),
        arrowprops=dict(arrowstyle="-[", color=color, lw=1.4),
    )
    ax.text(
        mid_x, max(y_base, y_top) * 1.12,
        label,
        ha="center", va="bottom",
        color=color, fontsize=9.5, fontweight="bold",
    )

# ---------------------------------------------------------------------------
# Chart 1 — Token Consumption (stacked: Input + Output)
# ---------------------------------------------------------------------------

fig1, ax1 = plt.subplots(figsize=(11, 7))
fig1.patch.set_facecolor(BG_DARK)

bars_in  = ax1.bar(x, df["Input_Tokens"],  BAR_W, label="Input Tokens",  color=INPUT_COLOR,  alpha=0.92, zorder=3)
bars_out = ax1.bar(x, df["Output_Tokens"], BAR_W, bottom=df["Input_Tokens"],
                   label="Output Tokens", color=OUTPUT_COLOR, alpha=0.92, zorder=3)

ax1.set_xticks(x)
ax1.set_xticklabels(scenarios, fontsize=11)
ax1.set_ylabel("Tokens", labelpad=10)
ax1.set_title("Token Consumption per Task\nInput vs. Output Across All Scenarios", pad=18)
ax1.yaxis.grid(True, zorder=0)
ax1.set_axisbelow(True)
ax1.spines[["top","right","left","bottom"]].set_visible(False)

# Value labels on top of each stacked bar
for i, row in df.iterrows():
    total = row["Total_Tokens"]
    ax1.text(i, total + 400, f"{total:,.0f}", ha="center", va="bottom",
             fontsize=10, fontweight="bold", color=TEXT_COLOR)

# Percentage-drop annotation: Baseline → God Mode
baseline_total = df.loc[df["Scenario"] == "Baseline", "Total_Tokens"].values[0]
godmode_total  = df.loc[df["Scenario"] == "OptiVault + Caveman", "Total_Tokens"].values[0]
drop_pct = (1 - godmode_total / baseline_total) * 100
ax1.annotate(
    f"⬇ {drop_pct:.0f}% Token Reduction!",
    xy=(3, godmode_total + 2500), xytext=(1.6, baseline_total * 0.72),
    arrowprops=dict(arrowstyle="->", color="#39d353", lw=1.6, connectionstyle="arc3,rad=-0.25"),
    fontsize=11, fontweight="bold", color="#39d353",
)

ax1.legend(loc="upper right")
plt.tight_layout()
fig1.savefig(os.path.join(OUT_DIR, "chart1_token_consumption.png"), dpi=180, bbox_inches="tight")
print("Saved chart1_token_consumption.png")

# ---------------------------------------------------------------------------
# Chart 2 — Execution Speed
# ---------------------------------------------------------------------------

fig2, ax2 = plt.subplots(figsize=(10, 6))
fig2.patch.set_facecolor(BG_DARK)

colors2 = [NEON[s] for s in scenarios]
bars2 = ax2.bar(x, df["Time_Seconds"], BAR_W, color=colors2, alpha=0.90, zorder=3)

ax2.set_xticks(x)
ax2.set_xticklabels(scenarios, fontsize=11)
ax2.set_ylabel("Seconds", labelpad=10)
ax2.set_title("Time to Complete Task\nLower is faster", pad=18)
ax2.yaxis.grid(True, zorder=0)
ax2.set_axisbelow(True)
ax2.spines[["top","right","left","bottom"]].set_visible(False)

for bar, val in zip(bars2, df["Time_Seconds"]):
    ax2.text(bar.get_x() + bar.get_width() / 2, val + 0.6,
             f"{val:.0f}s", ha="center", va="bottom", fontsize=11, fontweight="bold")

baseline_t = df.loc[df["Scenario"] == "Baseline", "Time_Seconds"].values[0]
godmode_t  = df.loc[df["Scenario"] == "OptiVault + Caveman", "Time_Seconds"].values[0]
speed_gain = baseline_t / godmode_t
ax2.text(3, godmode_t + 3,
         f">> {speed_gain:.0f}x faster than Baseline",
         ha="center", color="#39d353", fontsize=10.5, fontweight="bold")

plt.tight_layout()
fig2.savefig(os.path.join(OUT_DIR, "chart2_execution_speed.png"), dpi=180, bbox_inches="tight")
print("Saved chart2_execution_speed.png")

# ---------------------------------------------------------------------------
# Chart 3 — Cost per Task
# ---------------------------------------------------------------------------

fig3, ax3 = plt.subplots(figsize=(10, 6))
fig3.patch.set_facecolor(BG_DARK)

cost_dollars = df["Cost_Cents"] / 100

colors3 = [NEON[s] for s in scenarios]
bars3 = ax3.bar(x, cost_dollars, BAR_W, color=colors3, alpha=0.90, zorder=3)

ax3.set_xticks(x)
ax3.set_xticklabels(scenarios, fontsize=11)
ax3.set_ylabel("Cost (USD)", labelpad=10)
ax3.set_title("Cost per Task\nBased on Anthropic Sonnet 3.5 Pricing", pad=18)
ax3.yaxis.grid(True, zorder=0)
ax3.set_axisbelow(True)
ax3.spines[["top","right","left","bottom"]].set_visible(False)

# Format y-axis as cents
ax3.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"${v:.3f}"))

for bar, val in zip(bars3, cost_dollars):
    ax3.text(bar.get_x() + bar.get_width() / 2, val + 0.0008,
             f"${val:.3f}", ha="center", va="bottom", fontsize=11, fontweight="bold")

baseline_cost = cost_dollars.iloc[0]
godmode_cost  = cost_dollars.iloc[-1]
savings_pct   = (1 - godmode_cost / baseline_cost) * 100
daily_saves   = (baseline_cost - godmode_cost) * 100   # 100 tasks/day
ax3.text(
    1.5, baseline_cost * 0.55,
    f"⬇ {savings_pct:.0f}% cost savings\n≈ ${daily_saves:.2f} saved per 100 tasks/day",
    ha="center", color="#39d353", fontsize=10.5, fontweight="bold",
    bbox=dict(boxstyle="round,pad=0.4", facecolor="#0d1f14", edgecolor="#39d353", alpha=0.85),
)

plt.tight_layout()
fig3.savefig(os.path.join(OUT_DIR, "chart3_cost_per_task.png"), dpi=180, bbox_inches="tight")
print("Saved chart3_cost_per_task.png")

# ---------------------------------------------------------------------------
# Chart 4 — Composite Summary (2×2 grid — Twitter / LinkedIn hero card)
# ---------------------------------------------------------------------------

fig4, axes = plt.subplots(2, 2, figsize=(14, 9))
fig4.patch.set_facecolor(BG_DARK)
fig4.suptitle(
    "OptiVault × Caveman  —  Real-World Benchmark\nSame task, 4 tool configurations",
    fontsize=16, fontweight="bold", color=TEXT_COLOR, y=1.01,
)

# ── Top-left: Total Tokens ─────────────────────────────────────────────────
ax = axes[0][0]
ax.set_facecolor(BG_PANEL)
b = ax.bar(x, df["Total_Tokens"], BAR_W, color=[NEON[s] for s in scenarios], alpha=0.9, zorder=3)
ax.set_xticks(x); ax.set_xticklabels(scenarios, fontsize=8.5)
ax.set_title("Total Tokens", fontsize=12, pad=8)
ax.yaxis.grid(True, zorder=0); ax.set_axisbelow(True)
ax.spines[["top","right","left","bottom"]].set_visible(False)
for bar, val in zip(b, df["Total_Tokens"]):
    ax.text(bar.get_x() + bar.get_width()/2, val + 300, f"{val:,.0f}",
            ha="center", va="bottom", fontsize=8, fontweight="bold")

# ── Top-right: Time ────────────────────────────────────────────────────────
ax = axes[0][1]
ax.set_facecolor(BG_PANEL)
b = ax.bar(x, df["Time_Seconds"], BAR_W, color=[NEON[s] for s in scenarios], alpha=0.9, zorder=3)
ax.set_xticks(x); ax.set_xticklabels(scenarios, fontsize=8.5)
ax.set_title("Time to Completion (seconds)", fontsize=12, pad=8)
ax.yaxis.grid(True, zorder=0); ax.set_axisbelow(True)
ax.spines[["top","right","left","bottom"]].set_visible(False)
for bar, val in zip(b, df["Time_Seconds"]):
    ax.text(bar.get_x() + bar.get_width()/2, val + 0.4, f"{val:.0f}s",
            ha="center", va="bottom", fontsize=8, fontweight="bold")

# ── Bottom-left: Stacked tokens ────────────────────────────────────────────
ax = axes[1][0]
ax.set_facecolor(BG_PANEL)
ax.bar(x, df["Input_Tokens"],  BAR_W, label="Input",  color=INPUT_COLOR,  alpha=0.9, zorder=3)
ax.bar(x, df["Output_Tokens"], BAR_W, bottom=df["Input_Tokens"],
       label="Output", color=OUTPUT_COLOR, alpha=0.9, zorder=3)
ax.set_xticks(x); ax.set_xticklabels(scenarios, fontsize=8.5)
ax.set_title("Input vs. Output Tokens", fontsize=12, pad=8)
ax.yaxis.grid(True, zorder=0); ax.set_axisbelow(True)
ax.spines[["top","right","left","bottom"]].set_visible(False)
ax.legend(fontsize=8)

# ── Bottom-right: Cost ─────────────────────────────────────────────────────
ax = axes[1][1]
ax.set_facecolor(BG_PANEL)
b = ax.bar(x, cost_dollars, BAR_W, color=[NEON[s] for s in scenarios], alpha=0.9, zorder=3)
ax.set_xticks(x); ax.set_xticklabels(scenarios, fontsize=8.5)
ax.set_title("Cost per Task (USD)", fontsize=12, pad=8)
ax.yaxis.grid(True, zorder=0); ax.set_axisbelow(True)
ax.spines[["top","right","left","bottom"]].set_visible(False)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"${v:.3f}"))
for bar, val in zip(b, cost_dollars):
    ax.text(bar.get_x() + bar.get_width()/2, val + 0.0006, f"${val:.3f}",
            ha="center", va="bottom", fontsize=8, fontweight="bold")

# Stat callout box
fig4.text(
    0.5, -0.04,
    f"v {drop_pct:.0f}% token reduction  |  >> {speed_gain:.0f}x faster  |  v {savings_pct:.0f}% cheaper   --   OptiVault + Caveman vs. Baseline",
    ha="center", fontsize=12, fontweight="bold",
    color="#39d353",
    bbox=dict(boxstyle="round,pad=0.5", facecolor="#0d1f14", edgecolor="#39d353", alpha=0.9),
)

plt.tight_layout()
fig4.savefig(os.path.join(OUT_DIR, "chart4_hero_card.png"), dpi=180, bbox_inches="tight")
print("Saved chart4_hero_card.png")

print(f"\nAll charts saved to {OUT_DIR}/")
print("\n--- Key Stats ---")
print(f"Token reduction (Baseline -> God Mode):  {drop_pct:.1f}%")
print(f"Speed gain:                              {speed_gain:.1f}x")
print(f"Cost savings:                            {savings_pct:.1f}%")
print(f"Savings per 100 tasks/day:              ${daily_saves:.2f}")
