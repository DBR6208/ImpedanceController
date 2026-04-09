from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .config import DEFAULT_CONTROLLER_PRESETS, DEFAULT_SIM_CONFIG, SimulationConfig
from .controller import build_controller, parse_mode
from .plant import PegInHolePlant
from .schema import CSV_COLUMNS, StepLog


@dataclass(frozen=True)
class RunSummary:
    mode: str
    success: bool
    final_time_s: float
    insertion_time_s: float | None
    peak_contact_force_n: float
    max_lateral_error_m: float
    seed: int


def summary_to_jsonable(summary: RunSummary) -> dict[str, object]:
    return {
        "mode": summary.mode,
        "success": bool(summary.success),
        "final_time_s": float(summary.final_time_s),
        "insertion_time_s": (
            None if summary.insertion_time_s is None else float(summary.insertion_time_s)
        ),
        "peak_contact_force_n": float(summary.peak_contact_force_n),
        "max_lateral_error_m": float(summary.max_lateral_error_m),
        "seed": int(summary.seed),
    }


def config_to_jsonable(config: SimulationConfig) -> dict[str, object]:
    return {
        "mode": config.mode.value,
        "duration_s": float(config.duration_s),
        "dt_s": float(config.dt_s),
        "seed": int(config.seed),
        "noise_std_n": float(config.noise_std_n),
        "initial_position_m": [float(v) for v in config.initial_position_m],
        "initial_velocity_mps": [float(v) for v in config.initial_velocity_mps],
        "target_xy_m": [float(v) for v in config.target_xy_m],
        "target_z_m": float(config.target_z_m),
        "insertion_speed_mps": float(config.insertion_speed_mps),
        "success_radial_factor": float(config.success_radial_factor),
        "success_depth_m": float(config.success_depth_m),
        "stiffness_scale": float(config.stiffness_scale),
        "damping_scale": float(config.damping_scale),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run impedance alignment simulation.")
    parser.add_argument("--mode", type=str, default=DEFAULT_SIM_CONFIG.mode.value)
    parser.add_argument("--dt", type=float, default=DEFAULT_SIM_CONFIG.dt_s)
    parser.add_argument("--duration", type=float, default=DEFAULT_SIM_CONFIG.duration_s)
    parser.add_argument("--seed", type=int, default=DEFAULT_SIM_CONFIG.seed)
    parser.add_argument("--noise-std", type=float, default=DEFAULT_SIM_CONFIG.noise_std_n)
    parser.add_argument(
        "--initial-offset-x",
        type=float,
        default=DEFAULT_SIM_CONFIG.initial_position_m[0],
    )
    parser.add_argument(
        "--initial-offset-y",
        type=float,
        default=DEFAULT_SIM_CONFIG.initial_position_m[1],
    )
    parser.add_argument(
        "--initial-z",
        type=float,
        default=DEFAULT_SIM_CONFIG.initial_position_m[2],
    )
    parser.add_argument("--target-x", type=float, default=float("nan"))
    parser.add_argument("--target-y", type=float, default=float("nan"))
    parser.add_argument("--target-z", type=float, default=DEFAULT_SIM_CONFIG.target_z_m)
    parser.add_argument(
        "--insertion-speed",
        type=float,
        default=DEFAULT_SIM_CONFIG.insertion_speed_mps,
    )
    parser.add_argument(
        "--success-radial-factor",
        type=float,
        default=DEFAULT_SIM_CONFIG.success_radial_factor,
    )
    parser.add_argument(
        "--success-depth",
        type=float,
        default=DEFAULT_SIM_CONFIG.success_depth_m,
    )
    parser.add_argument("--stiffness-scale", type=float, default=1.0)
    parser.add_argument("--damping-scale", type=float, default=1.0)
    parser.add_argument("--output-csv", type=str, default="")
    parser.add_argument("--output-meta", type=str, default="")
    return parser.parse_args()


def build_sim_config(args: argparse.Namespace) -> SimulationConfig:
    target_x = (
        float(DEFAULT_SIM_CONFIG.target_xy_m[0])
        if np.isnan(float(args.target_x))
        else float(args.target_x)
    )
    target_y = (
        float(DEFAULT_SIM_CONFIG.target_xy_m[1])
        if np.isnan(float(args.target_y))
        else float(args.target_y)
    )
    return SimulationConfig(
        mode=parse_mode(args.mode),
        duration_s=float(args.duration),
        dt_s=float(args.dt),
        seed=int(args.seed),
        noise_std_n=float(args.noise_std),
        initial_position_m=(
            float(args.initial_offset_x),
            float(args.initial_offset_y),
            float(args.initial_z),
        ),
        initial_velocity_mps=DEFAULT_SIM_CONFIG.initial_velocity_mps,
        target_xy_m=(target_x, target_y),
        target_z_m=float(args.target_z),
        insertion_speed_mps=float(args.insertion_speed),
        success_radial_factor=float(args.success_radial_factor),
        success_depth_m=float(args.success_depth),
        stiffness_scale=float(args.stiffness_scale),
        damping_scale=float(args.damping_scale),
    )


def default_output_paths(config: SimulationConfig) -> tuple[Path, Path]:
    stem = f"run_{config.mode.value}"
    csv_path = Path("results") / f"{stem}.csv"
    meta_path = Path("results") / f"{stem}_meta.json"
    return csv_path, meta_path


def is_successful(
    position_m: np.ndarray,
    clearance_m: float,
    plate_z_m: float,
    radial_factor: float,
    success_depth_m: float,
) -> bool:
    lateral_error = float(np.linalg.norm(position_m[:2]))
    return bool(
        lateral_error <= radial_factor * clearance_m
        and position_m[2] <= plate_z_m - success_depth_m
    )


def run(config: SimulationConfig, csv_path: Path, meta_path: Path) -> RunSummary:
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

    csv_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.parent.mkdir(parents=True, exist_ok=True)

    steps = int(config.duration_s / config.dt_s)
    peak_contact_force = 0.0
    max_lateral_error = 0.0
    insertion_time_s: float | None = None
    success_flag = False

    with csv_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=CSV_COLUMNS)
        writer.writeheader()

        for _ in range(steps):
            state = plant.state
            control = controller.compute(state, plant.t_s)
            step = plant.step(control.commanded_force_n)

            contact_force = float(np.linalg.norm(step.contact.force_n))
            total_force = float(np.linalg.norm(step.total_force_n))
            lateral_error = float(np.linalg.norm(step.state.position_m[:2] - control.reference_position_m[:2]))
            success_flag = is_successful(
                step.state.position_m,
                clearance_m=plant.clearance_m,
                plate_z_m=plant.plate_z_m,
                radial_factor=config.success_radial_factor,
                success_depth_m=config.success_depth_m,
            )
            if success_flag and insertion_time_s is None:
                insertion_time_s = plant.t_s

            peak_contact_force = max(peak_contact_force, contact_force)
            max_lateral_error = max(max_lateral_error, lateral_error)

            log_row = StepLog(
                t_s=plant.t_s,
                mode=config.mode.value,
                success=int(success_flag),
                in_contact=int(step.contact.in_contact),
                x_m=float(step.state.position_m[0]),
                y_m=float(step.state.position_m[1]),
                z_m=float(step.state.position_m[2]),
                vx_mps=float(step.state.velocity_mps[0]),
                vy_mps=float(step.state.velocity_mps[1]),
                vz_mps=float(step.state.velocity_mps[2]),
                x_ref_m=float(control.reference_position_m[0]),
                y_ref_m=float(control.reference_position_m[1]),
                z_ref_m=float(control.reference_position_m[2]),
                lateral_error_m=lateral_error,
                control_fx_n=float(control.commanded_force_n[0]),
                control_fy_n=float(control.commanded_force_n[1]),
                control_fz_n=float(control.commanded_force_n[2]),
                contact_fx_n=float(step.contact.force_n[0]),
                contact_fy_n=float(step.contact.force_n[1]),
                contact_fz_n=float(step.contact.force_n[2]),
                contact_force_n=contact_force,
                total_force_n=total_force,
                penetration_m=float(step.contact.penetration_m),
            )
            writer.writerow(log_row.to_row())

    summary = RunSummary(
        mode=config.mode.value,
        success=success_flag,
        final_time_s=plant.t_s,
        insertion_time_s=insertion_time_s,
        peak_contact_force_n=peak_contact_force,
        max_lateral_error_m=max_lateral_error,
        seed=config.seed,
    )
    with meta_path.open("w", encoding="utf-8") as meta_file:
        payload = {
            "summary": summary_to_jsonable(summary),
            "config": config_to_jsonable(config),
            "csv_columns": list(CSV_COLUMNS),
        }
        json.dump(payload, meta_file, indent=2)

    return summary


def main() -> None:
    args = parse_args()
    config = build_sim_config(args)
    default_csv, default_meta = default_output_paths(config)
    csv_path = Path(args.output_csv) if args.output_csv else default_csv
    meta_path = Path(args.output_meta) if args.output_meta else default_meta
    summary = run(config, csv_path, meta_path)

    print(f"mode={summary.mode}")
    print(f"success={summary.success}")
    print(f"insertion_time_s={summary.insertion_time_s}")
    print(f"peak_contact_force_n={summary.peak_contact_force_n:.4f}")
    print(f"max_lateral_error_m={summary.max_lateral_error_m:.6f}")
    print(f"log_csv={csv_path.as_posix()}")
    print(f"log_meta={meta_path.as_posix()}")


if __name__ == "__main__":
    main()
