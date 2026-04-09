"""Experiment sweeps and plot generation for impedance alignment demo."""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Iterable, Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from numpy.typing import NDArray

from simulation.config import (
    DEFAULT_CONTROLLER_PRESETS,
    DEFAULT_SIM_CONFIG,
    ControllerMode,
    SimulationConfig,
)
from simulation.controller import build_controller
from simulation.plant import PegInHolePlant
from simulation.run_sim import is_successful


Vector = NDArray[np.float64]


@dataclass(frozen=True)
class TrialMetrics:
    mode: str
    seed: int
    stiffness_scale: float
    damping_scale: float
    noise_std_n: float
    offset_m: float
    success: int
    insertion_time_s: float
    peak_contact_force_n: float
    settling_time_s: float
    overshoot_m: float
    oscillation_m: float
    final_center_error_m: float


@dataclass(frozen=True)
class TraceData:
    t_s: Vector
    contact_force_n: Vector
    center_error_m: Vector
    in_contact: NDArray[np.int8]
    metrics: TrialMetrics


@dataclass(frozen=True)
class SweepConfig:
    stiffness_scales: tuple[float, ...]
    damping_scales: tuple[float, ...]
    offset_values_m: tuple[float, ...]
    noise_values_n: tuple[float, ...]
    heatmap_stiffness_scales: tuple[float, ...]
    heatmap_offset_values_m: tuple[float, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run benchmark sweeps and generate plots.")
    parser.add_argument("--results-dir", type=str, default="results")
    parser.add_argument("--plots-dir", type=str, default="plots")
    parser.add_argument("--seed-start", type=int, default=1)
    parser.add_argument("--num-seeds", type=int, default=6)
    parser.add_argument("--quick", action="store_true", help="Run a reduced sweep set.")
    return parser.parse_args()


def build_sweep_config(quick: bool) -> SweepConfig:
    if quick:
        return SweepConfig(
            stiffness_scales=(0.7, 1.0, 1.3, 1.6),
            damping_scales=(0.7, 1.0, 1.4, 1.8),
            offset_values_m=(0.0012, 0.0016, 0.0020, 0.0024, 0.0028),
            noise_values_n=(0.0, 0.1, 0.2),
            heatmap_stiffness_scales=(0.7, 1.0, 1.3, 1.6),
            heatmap_offset_values_m=(0.0012, 0.0016, 0.0020, 0.0024, 0.0028),
        )
    return SweepConfig(
        stiffness_scales=(0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8),
        damping_scales=(0.5, 0.7, 1.0, 1.3, 1.6, 2.0, 2.4),
        offset_values_m=(0.0010, 0.0014, 0.0018, 0.0022, 0.0026, 0.0030, 0.0034),
        noise_values_n=(0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3),
        heatmap_stiffness_scales=(0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8),
        heatmap_offset_values_m=(0.0010, 0.0014, 0.0018, 0.0022, 0.0026, 0.0030, 0.0034),
    )


def offset_direction_xy(config: SimulationConfig) -> Vector:
    xy = np.asarray(config.initial_position_m[:2], dtype=np.float64)
    norm = float(np.linalg.norm(xy))
    if norm <= 1e-12:
        return np.asarray([1.0, 0.0], dtype=np.float64)
    return xy / norm


def config_with_offset(config: SimulationConfig, offset_m: float) -> SimulationConfig:
    direction = offset_direction_xy(config)
    xy = direction * offset_m
    return replace(
        config,
        initial_position_m=(float(xy[0]), float(xy[1]), config.initial_position_m[2]),
        target_xy_m=(float(xy[0]), float(xy[1])),
    )


def compute_settling_time(t_s: Vector, center_error_m: Vector, band_m: float) -> float:
    inside = center_error_m <= band_m
    if not np.any(inside):
        return float("nan")
    suffix_all_inside = np.flip(np.cumprod(np.flip(inside).astype(np.int32))).astype(bool)
    indices = np.flatnonzero(suffix_all_inside)
    if indices.size == 0:
        return float("nan")
    return float(t_s[int(indices[0])])


def compute_overshoot(center_error_m: Vector) -> float:
    min_idx = int(np.argmin(center_error_m))
    rebound = float(np.max(center_error_m[min_idx:]) - center_error_m[min_idx])
    return max(0.0, rebound)


def compute_oscillation_magnitude(center_error_m: Vector, in_contact: NDArray[np.int8]) -> float:
    if center_error_m.size < 8:
        return 0.0
    contact_idx = np.flatnonzero(in_contact > 0)
    start_idx = int(contact_idx[0]) if contact_idx.size > 0 else center_error_m.size // 3
    segment = center_error_m[start_idx:]
    if segment.size < 8:
        segment = center_error_m
    window = max(5, segment.size // 30)
    kernel = np.ones(window, dtype=np.float64) / float(window)
    smooth = np.convolve(segment, kernel, mode="same")
    residual = segment - smooth
    return float(np.sqrt(np.mean(residual * residual)))


def simulate_trace(config: SimulationConfig) -> TraceData:
    controller = build_controller(config)
    preset = DEFAULT_CONTROLLER_PRESETS[config.mode]
    plant = PegInHolePlant(
        mass_kg_xyz=preset.mass_xyz,
        dt_s=config.dt_s,
        initial_position_m=config.initial_position_m,
        initial_velocity_mps=config.initial_velocity_mps,
        noise_std_n=config.noise_std_n,
        seed=config.seed,
    )

    steps = max(1, int(round(config.duration_s / config.dt_s)))
    t_s = np.empty(steps, dtype=np.float64)
    contact_force_n = np.empty(steps, dtype=np.float64)
    center_error_m = np.empty(steps, dtype=np.float64)
    in_contact = np.empty(steps, dtype=np.int8)

    success_flag = False
    insertion_time_s = float("nan")
    for idx in range(steps):
        state = plant.state
        control = controller.compute(state, plant.t_s)
        step = plant.step(control.commanded_force_n)

        t_s[idx] = plant.t_s
        contact_force_n[idx] = float(np.linalg.norm(step.contact.force_n))
        center_error_m[idx] = float(np.linalg.norm(step.state.position_m[:2]))
        in_contact[idx] = int(step.contact.in_contact)

        success_now = is_successful(
            step.state.position_m,
            clearance_m=plant.clearance_m,
            plate_z_m=plant.plate_z_m,
            radial_factor=config.success_radial_factor,
            success_depth_m=config.success_depth_m,
        )
        success_flag = bool(success_now)
        if np.isnan(insertion_time_s) and success_now:
            insertion_time_s = plant.t_s

    settling_band_m = config.success_radial_factor * plant.clearance_m
    settling_time_s = compute_settling_time(t_s, center_error_m, settling_band_m)
    overshoot_m = compute_overshoot(center_error_m)
    oscillation_m = compute_oscillation_magnitude(center_error_m, in_contact)
    offset_m = float(np.linalg.norm(config.initial_position_m[:2]))

    metrics = TrialMetrics(
        mode=config.mode.value,
        seed=int(config.seed),
        stiffness_scale=float(config.stiffness_scale),
        damping_scale=float(config.damping_scale),
        noise_std_n=float(config.noise_std_n),
        offset_m=offset_m,
        success=int(success_flag),
        insertion_time_s=float(insertion_time_s),
        peak_contact_force_n=float(np.max(contact_force_n)),
        settling_time_s=float(settling_time_s),
        overshoot_m=float(overshoot_m),
        oscillation_m=float(oscillation_m),
        final_center_error_m=float(center_error_m[-1]),
    )
    return TraceData(
        t_s=t_s,
        contact_force_n=contact_force_n,
        center_error_m=center_error_m,
        in_contact=in_contact,
        metrics=metrics,
    )


def run_trials(
    base_config: SimulationConfig,
    mode: ControllerMode,
    seeds: Sequence[int],
    stiffness_scale: float = 1.0,
    damping_scale: float = 1.0,
    noise_std_n: float | None = None,
    offset_m: float | None = None,
) -> list[TrialMetrics]:
    config = replace(
        base_config,
        mode=mode,
        stiffness_scale=stiffness_scale,
        damping_scale=damping_scale,
    )
    if noise_std_n is not None:
        config = replace(config, noise_std_n=noise_std_n)
    if offset_m is not None:
        config = config_with_offset(config, offset_m)

    metrics: list[TrialMetrics] = []
    for seed in seeds:
        trial_config = replace(config, seed=int(seed))
        metrics.append(simulate_trace(trial_config).metrics)
    return metrics


def finite_mean(values: Iterable[float]) -> float:
    arr = np.asarray(list(values), dtype=np.float64)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0:
        return float("nan")
    return float(np.mean(arr))


def finite_std(values: Iterable[float]) -> float:
    arr = np.asarray(list(values), dtype=np.float64)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0:
        return float("nan")
    return float(np.std(arr))


def aggregate_trials(metrics: Sequence[TrialMetrics], context: dict[str, float | str]) -> dict[str, float | str]:
    row: dict[str, float | str] = dict(context)
    row["trial_count"] = float(len(metrics))
    row["success_rate"] = float(np.mean([m.success for m in metrics]))
    row["peak_contact_force_mean_n"] = finite_mean(m.peak_contact_force_n for m in metrics)
    row["peak_contact_force_std_n"] = finite_std(m.peak_contact_force_n for m in metrics)
    row["insertion_time_mean_s"] = finite_mean(m.insertion_time_s for m in metrics)
    row["settling_time_mean_s"] = finite_mean(m.settling_time_s for m in metrics)
    row["overshoot_mean_m"] = finite_mean(m.overshoot_m for m in metrics)
    row["oscillation_mean_m"] = finite_mean(m.oscillation_m for m in metrics)
    row["final_center_error_mean_m"] = finite_mean(m.final_center_error_m for m in metrics)
    return row


def write_rows_csv(path: Path, rows: Sequence[dict[str, float | int | str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames = list(rows[0].keys())
    for row in rows[1:]:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_metrics_csv(path: Path, metrics: Sequence[TrialMetrics]) -> None:
    rows = [asdict(metric) for metric in metrics]
    write_rows_csv(path, rows)


def save_force_and_displacement(
    stiff_trace: TraceData,
    imp_trace: TraceData,
    results_dir: Path,
    plots_dir: Path,
) -> None:
    n = min(stiff_trace.t_s.size, imp_trace.t_s.size)
    rows: list[dict[str, float]] = []
    for idx in range(n):
        rows.append(
            {
                "t_s": float(stiff_trace.t_s[idx]),
                "stiff_contact_force_n": float(stiff_trace.contact_force_n[idx]),
                "impedance_contact_force_n": float(imp_trace.contact_force_n[idx]),
                "stiff_center_error_m": float(stiff_trace.center_error_m[idx]),
                "impedance_center_error_m": float(imp_trace.center_error_m[idx]),
            }
        )
    write_rows_csv(results_dir / "force_displacement_timeseries.csv", rows)

    fig_force, ax_force = plt.subplots(figsize=(9, 4.5))
    ax_force.plot(stiff_trace.t_s, stiff_trace.contact_force_n, label="Stiff", linewidth=2.0)
    ax_force.plot(imp_trace.t_s, imp_trace.contact_force_n, label="Impedance", linewidth=2.0)
    ax_force.set_title("Contact Force vs Time")
    ax_force.set_xlabel("Time [s]")
    ax_force.set_ylabel("Contact Force [N]")
    ax_force.grid(alpha=0.3)
    ax_force.legend()
    fig_force.tight_layout()
    fig_force.savefig(plots_dir / "force_vs_time.png", dpi=180)
    plt.close(fig_force)

    fig_err, ax_err = plt.subplots(figsize=(9, 4.5))
    ax_err.plot(stiff_trace.t_s, 1e3 * stiff_trace.center_error_m, label="Stiff", linewidth=2.0)
    ax_err.plot(imp_trace.t_s, 1e3 * imp_trace.center_error_m, label="Impedance", linewidth=2.0)
    ax_err.set_title("Lateral Center Error vs Time")
    ax_err.set_xlabel("Time [s]")
    ax_err.set_ylabel("Center Error [mm]")
    ax_err.grid(alpha=0.3)
    ax_err.legend()
    fig_err.tight_layout()
    fig_err.savefig(plots_dir / "displacement_vs_time.png", dpi=180)
    plt.close(fig_err)


def split_mode_metrics(metrics: Sequence[TrialMetrics]) -> dict[str, list[TrialMetrics]]:
    grouped: dict[str, list[TrialMetrics]] = {}
    for item in metrics:
        grouped.setdefault(item.mode, []).append(item)
    return grouped


def save_mode_summary_plots(
    metrics: Sequence[TrialMetrics],
    results_dir: Path,
    plots_dir: Path,
    duration_s: float,
) -> None:
    grouped = split_mode_metrics(metrics)
    mode_labels = [ControllerMode.STIFF.value, ControllerMode.IMPEDANCE.value]

    success_counts = [sum(m.success for m in grouped.get(mode, [])) for mode in mode_labels]
    total_counts = [len(grouped.get(mode, [])) for mode in mode_labels]
    fail_counts = [total - success for total, success in zip(total_counts, success_counts)]

    fig_success, ax_success = plt.subplots(figsize=(7, 4.5))
    ax_success.bar(mode_labels, success_counts, label="Success")
    ax_success.bar(mode_labels, fail_counts, bottom=success_counts, label="Failure")
    ax_success.set_title("Insertion Success vs Failure")
    ax_success.set_ylabel("Trials")
    ax_success.grid(axis="y", alpha=0.3)
    ax_success.legend()
    fig_success.tight_layout()
    fig_success.savefig(plots_dir / "success_failure_bar.png", dpi=180)
    plt.close(fig_success)

    overshoot_means = [1e3 * finite_mean(m.overshoot_m for m in grouped.get(mode, [])) for mode in mode_labels]
    fig_over, ax_over = plt.subplots(figsize=(7, 4.5))
    ax_over.bar(mode_labels, overshoot_means)
    ax_over.set_title("Overshoot Magnitude")
    ax_over.set_ylabel("Overshoot [mm]")
    ax_over.grid(axis="y", alpha=0.3)
    fig_over.tight_layout()
    fig_over.savefig(plots_dir / "overshoot_plot.png", dpi=180)
    plt.close(fig_over)

    settling_means = [finite_mean(m.settling_time_s for m in grouped.get(mode, [])) for mode in mode_labels]
    settling_plot = [duration_s if not np.isfinite(value) else value for value in settling_means]
    fig_settle, ax_settle = plt.subplots(figsize=(7, 4.5))
    bars = ax_settle.bar(mode_labels, settling_plot)
    ax_settle.set_title("Settling Time")
    ax_settle.set_ylabel("Settling Time [s]")
    ax_settle.grid(axis="y", alpha=0.3)
    for mode, bar, mean_value in zip(mode_labels, bars, settling_means):
        if not np.isfinite(mean_value):
            ax_settle.text(
                bar.get_x() + bar.get_width() * 0.5,
                bar.get_height() + 0.02,
                "not settled",
                ha="center",
                va="bottom",
                fontsize=9,
            )
    fig_settle.tight_layout()
    fig_settle.savefig(plots_dir / "settling_time_plot.png", dpi=180)
    plt.close(fig_settle)

    summary_rows: list[dict[str, float | str]] = []
    for mode in mode_labels:
        items = grouped.get(mode, [])
        summary_rows.append(
            {
                "mode": mode,
                "trial_count": float(len(items)),
                "success_rate": float(np.mean([m.success for m in items])) if items else float("nan"),
                "peak_contact_force_mean_n": finite_mean(m.peak_contact_force_n for m in items),
                "overshoot_mean_m": finite_mean(m.overshoot_m for m in items),
                "settling_time_mean_s": finite_mean(m.settling_time_s for m in items),
            }
        )
    write_rows_csv(results_dir / "success_rate_comparison.csv", summary_rows)


def rows_for_mode(rows: Sequence[dict[str, float | str]], mode: str, x_key: str) -> list[dict[str, float | str]]:
    filtered = [row for row in rows if str(row.get("mode")) == mode]
    return sorted(filtered, key=lambda row: float(row[x_key]))


def save_stiffness_tradeoff_plot(rows: Sequence[dict[str, float | str]], plots_dir: Path) -> None:
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.8))
    for mode, label in ((ControllerMode.STIFF.value, "Stiff"), (ControllerMode.IMPEDANCE.value, "Impedance")):
        mode_rows = rows_for_mode(rows, mode, "stiffness_scale")
        x = [float(row["stiffness_scale"]) for row in mode_rows]
        peak = [float(row["peak_contact_force_mean_n"]) for row in mode_rows]
        success = [float(row["success_rate"]) for row in mode_rows]
        settling = [float(row["settling_time_mean_s"]) for row in mode_rows]

        axes[0].plot(x, peak, marker="o", label=label)
        axes[1].plot(x, success, marker="o", label=label)
        axes[2].plot(x, settling, marker="o", label=label)

    axes[0].set_title("Peak Force")
    axes[0].set_xlabel("Stiffness Scale")
    axes[0].set_ylabel("Peak Contact Force [N]")
    axes[1].set_title("Success Rate")
    axes[1].set_xlabel("Stiffness Scale")
    axes[1].set_ylabel("Success Rate")
    axes[1].set_ylim(-0.05, 1.05)
    axes[2].set_title("Settling Time")
    axes[2].set_xlabel("Stiffness Scale")
    axes[2].set_ylabel("Settling Time [s]")

    for axis in axes:
        axis.grid(alpha=0.3)
    axes[0].legend()
    fig.suptitle("Stiffness Tradeoffs")
    fig.tight_layout()
    fig.savefig(plots_dir / "stiffness_tradeoff.png", dpi=180)
    plt.close(fig)


def save_damping_tradeoff_plot(rows: Sequence[dict[str, float | str]], plots_dir: Path) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6))
    for mode, label in ((ControllerMode.STIFF.value, "Stiff"), (ControllerMode.IMPEDANCE.value, "Impedance")):
        mode_rows = rows_for_mode(rows, mode, "damping_scale")
        x = [float(row["damping_scale"]) for row in mode_rows]
        oscillation_mm = [1e3 * float(row["oscillation_mean_m"]) for row in mode_rows]
        insertion_s = [float(row["insertion_time_mean_s"]) for row in mode_rows]
        axes[0].plot(x, oscillation_mm, marker="o", label=label)
        axes[1].plot(x, insertion_s, marker="o", label=label)

    axes[0].set_title("Oscillation Magnitude")
    axes[0].set_xlabel("Damping Scale")
    axes[0].set_ylabel("Oscillation [mm]")
    axes[1].set_title("Insertion Time")
    axes[1].set_xlabel("Damping Scale")
    axes[1].set_ylabel("Insertion Time [s]")
    for axis in axes:
        axis.grid(alpha=0.3)
    axes[0].legend()
    fig.suptitle("Damping Tradeoffs")
    fig.tight_layout()
    fig.savefig(plots_dir / "damping_tradeoff.png", dpi=180)
    plt.close(fig)


def save_heatmap_plot(
    rows: Sequence[dict[str, float | str]],
    stiffness_scales: Sequence[float],
    offset_values_m: Sequence[float],
    plots_dir: Path,
) -> None:
    x_values = list(stiffness_scales)
    y_values = list(offset_values_m)
    mode_names = [ControllerMode.STIFF.value, ControllerMode.IMPEDANCE.value]

    matrices: dict[str, NDArray[np.float64]] = {}
    for mode in mode_names:
        matrix = np.full((len(y_values), len(x_values)), np.nan, dtype=np.float64)
        for row in rows:
            if str(row.get("mode")) != mode:
                continue
            x = float(row["stiffness_scale"])
            y = float(row["offset_m"])
            if x in x_values and y in y_values:
                j = x_values.index(x)
                i = y_values.index(y)
                matrix[i, j] = float(row["success_rate"])
        matrices[mode] = matrix

    fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.8), sharey=True, constrained_layout=True)
    for axis, mode, title in zip(axes, mode_names, ("Stiff Control", "Impedance Control")):
        image = axis.imshow(
            matrices[mode],
            origin="lower",
            aspect="auto",
            vmin=0.0,
            vmax=1.0,
            cmap="viridis",
        )
        axis.set_title(title)
        axis.set_xlabel("Stiffness Scale")
        axis.set_xticks(range(len(x_values)))
        axis.set_xticklabels([f"{value:.2f}" for value in x_values], rotation=45, ha="right")
        axis.set_yticks(range(len(y_values)))
        axis.set_yticklabels([f"{1e3 * value:.1f}" for value in y_values])
    axes[0].set_ylabel("Initial Offset [mm]")
    colorbar = fig.colorbar(image, ax=axes.ravel().tolist(), fraction=0.046, pad=0.04)
    colorbar.set_label("Success Rate")
    fig.suptitle("Success-Rate Heatmap vs Stiffness and Offset")
    fig.savefig(plots_dir / "robustness_heatmap.png", dpi=180)
    plt.close(fig)


def save_robustness_line_plot(
    rows: Sequence[dict[str, float | str]],
    x_key: str,
    x_label: str,
    filename: str,
    plots_dir: Path,
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6))
    for mode, label in ((ControllerMode.STIFF.value, "Stiff"), (ControllerMode.IMPEDANCE.value, "Impedance")):
        mode_rows = rows_for_mode(rows, mode, x_key)
        x = [float(row[x_key]) for row in mode_rows]
        success = [float(row["success_rate"]) for row in mode_rows]
        peak = [float(row["peak_contact_force_mean_n"]) for row in mode_rows]
        axes[0].plot(x, success, marker="o", label=label)
        axes[1].plot(x, peak, marker="o", label=label)

    axes[0].set_title("Success Rate")
    axes[0].set_xlabel(x_label)
    axes[0].set_ylabel("Success Rate")
    axes[0].set_ylim(-0.05, 1.05)
    axes[1].set_title("Peak Contact Force")
    axes[1].set_xlabel(x_label)
    axes[1].set_ylabel("Peak Contact Force [N]")
    for axis in axes:
        axis.grid(alpha=0.3)
    axes[0].legend()
    fig.suptitle(f"{x_label} Robustness")
    fig.tight_layout()
    fig.savefig(plots_dir / filename, dpi=180)
    plt.close(fig)


def run_stiffness_sweep(
    base_config: SimulationConfig,
    seeds: Sequence[int],
    scales: Sequence[float],
) -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for mode in (ControllerMode.STIFF, ControllerMode.IMPEDANCE):
        for scale in scales:
            metrics = run_trials(
                base_config=base_config,
                mode=mode,
                seeds=seeds,
                stiffness_scale=float(scale),
                damping_scale=1.0,
            )
            rows.append(
                aggregate_trials(
                    metrics,
                    context={
                        "mode": mode.value,
                        "stiffness_scale": float(scale),
                        "damping_scale": 1.0,
                    },
                )
            )
    return rows


def run_damping_sweep(
    base_config: SimulationConfig,
    seeds: Sequence[int],
    scales: Sequence[float],
) -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for mode in (ControllerMode.STIFF, ControllerMode.IMPEDANCE):
        for scale in scales:
            metrics = run_trials(
                base_config=base_config,
                mode=mode,
                seeds=seeds,
                stiffness_scale=1.0,
                damping_scale=float(scale),
            )
            rows.append(
                aggregate_trials(
                    metrics,
                    context={
                        "mode": mode.value,
                        "stiffness_scale": 1.0,
                        "damping_scale": float(scale),
                    },
                )
            )
    return rows


def run_offset_robustness(
    base_config: SimulationConfig,
    seeds: Sequence[int],
    offsets_m: Sequence[float],
) -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for mode in (ControllerMode.STIFF, ControllerMode.IMPEDANCE):
        for offset_m in offsets_m:
            metrics = run_trials(
                base_config=base_config,
                mode=mode,
                seeds=seeds,
                offset_m=float(offset_m),
            )
            rows.append(
                aggregate_trials(
                    metrics,
                    context={
                        "mode": mode.value,
                        "offset_m": float(offset_m),
                    },
                )
            )
    return rows


def run_noise_robustness(
    base_config: SimulationConfig,
    seeds: Sequence[int],
    noises_n: Sequence[float],
) -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for mode in (ControllerMode.STIFF, ControllerMode.IMPEDANCE):
        for noise in noises_n:
            metrics = run_trials(
                base_config=base_config,
                mode=mode,
                seeds=seeds,
                noise_std_n=float(noise),
            )
            rows.append(
                aggregate_trials(
                    metrics,
                    context={
                        "mode": mode.value,
                        "noise_std_n": float(noise),
                    },
                )
            )
    return rows


def run_success_heatmap(
    base_config: SimulationConfig,
    seeds: Sequence[int],
    stiffness_scales: Sequence[float],
    offsets_m: Sequence[float],
) -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for mode in (ControllerMode.STIFF, ControllerMode.IMPEDANCE):
        for stiffness_scale in stiffness_scales:
            for offset_m in offsets_m:
                metrics = run_trials(
                    base_config=base_config,
                    mode=mode,
                    seeds=seeds,
                    stiffness_scale=float(stiffness_scale),
                    damping_scale=1.0,
                    offset_m=float(offset_m),
                )
                rows.append(
                    aggregate_trials(
                        metrics,
                        context={
                            "mode": mode.value,
                            "stiffness_scale": float(stiffness_scale),
                            "offset_m": float(offset_m),
                        },
                    )
                )
    return rows


def seed_sequence(seed_start: int, count: int) -> list[int]:
    return [seed_start + i for i in range(count)]


def main() -> None:
    args = parse_args()
    results_dir = Path(args.results_dir)
    plots_dir = Path(args.plots_dir)
    results_dir.mkdir(parents=True, exist_ok=True)
    plots_dir.mkdir(parents=True, exist_ok=True)

    sweep = build_sweep_config(quick=bool(args.quick))
    seeds = seed_sequence(args.seed_start, args.num_seeds)
    base_config = DEFAULT_SIM_CONFIG

    baseline_seed = seeds[0]
    stiff_trace = simulate_trace(replace(base_config, mode=ControllerMode.STIFF, seed=baseline_seed))
    imp_trace = simulate_trace(replace(base_config, mode=ControllerMode.IMPEDANCE, seed=baseline_seed))
    save_force_and_displacement(stiff_trace, imp_trace, results_dir, plots_dir)

    baseline_metrics: list[TrialMetrics] = []
    for mode in (ControllerMode.STIFF, ControllerMode.IMPEDANCE):
        baseline_metrics.extend(run_trials(base_config=base_config, mode=mode, seeds=seeds))
    write_metrics_csv(results_dir / "force_spike_comparison.csv", baseline_metrics)
    save_mode_summary_plots(
        metrics=baseline_metrics,
        results_dir=results_dir,
        plots_dir=plots_dir,
        duration_s=base_config.duration_s,
    )

    stiffness_rows = run_stiffness_sweep(base_config, seeds, sweep.stiffness_scales)
    damping_rows = run_damping_sweep(base_config, seeds, sweep.damping_scales)
    offset_rows = run_offset_robustness(base_config, seeds, sweep.offset_values_m)
    noise_rows = run_noise_robustness(base_config, seeds, sweep.noise_values_n)
    heatmap_rows = run_success_heatmap(
        base_config,
        seeds,
        sweep.heatmap_stiffness_scales,
        sweep.heatmap_offset_values_m,
    )

    write_rows_csv(results_dir / "stiffness_sweep.csv", stiffness_rows)
    write_rows_csv(results_dir / "damping_sweep.csv", damping_rows)
    write_rows_csv(results_dir / "offset_robustness.csv", offset_rows)
    write_rows_csv(results_dir / "noise_robustness.csv", noise_rows)
    write_rows_csv(results_dir / "success_heatmap.csv", heatmap_rows)

    save_stiffness_tradeoff_plot(stiffness_rows, plots_dir)
    save_damping_tradeoff_plot(damping_rows, plots_dir)
    save_robustness_line_plot(
        rows=offset_rows,
        x_key="offset_m",
        x_label="Initial Offset [m]",
        filename="offset_robustness.png",
        plots_dir=plots_dir,
    )
    save_robustness_line_plot(
        rows=noise_rows,
        x_key="noise_std_n",
        x_label="Noise Std [N]",
        filename="noise_robustness.png",
        plots_dir=plots_dir,
    )
    save_heatmap_plot(
        rows=heatmap_rows,
        stiffness_scales=sweep.heatmap_stiffness_scales,
        offset_values_m=sweep.heatmap_offset_values_m,
        plots_dir=plots_dir,
    )

    metadata = {
        "seed_start": int(args.seed_start),
        "num_seeds": int(args.num_seeds),
        "quick": bool(args.quick),
        "base_config": {
            "duration_s": float(base_config.duration_s),
            "dt_s": float(base_config.dt_s),
            "noise_std_n": float(base_config.noise_std_n),
            "initial_position_m": list(base_config.initial_position_m),
            "target_xy_m": list(base_config.target_xy_m),
            "target_z_m": float(base_config.target_z_m),
            "success_radial_factor": float(base_config.success_radial_factor),
            "success_depth_m": float(base_config.success_depth_m),
        },
        "sweep": asdict(sweep),
        "outputs": {
            "results_dir": results_dir.as_posix(),
            "plots_dir": plots_dir.as_posix(),
        },
    }
    (results_dir / "benchmark_metadata.json").write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    print("Benchmark complete.")
    print(f"Results CSVs: {results_dir.as_posix()}")
    print(f"Plots: {plots_dir.as_posix()}")


if __name__ == "__main__":
    main()
