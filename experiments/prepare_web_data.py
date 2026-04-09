"""Phase 4 integration helper: sync backend logs into web/public/data.

This script:
1) Generates canonical stiff/impedance runs in ``results/``.
2) Ensures benchmark sweep CSVs exist (quick benchmark by default if missing).
3) Validates the canonical story:
   - stiff should fail and spike higher force
   - impedance should succeed and insert
4) Copies required CSV/JSON artifacts into ``web/public/data`` for frontend playback.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


REQUIRED_TRACE_FILES = (
    "run_stiff.csv",
    "run_stiff_meta.json",
    "run_impedance.csv",
    "run_impedance_meta.json",
)

REQUIRED_SWEEP_FILES = (
    "stiffness_sweep.csv",
    "damping_sweep.csv",
    "success_heatmap.csv",
)

CANONICAL_SCENARIO_ARGS = (
    "--dt",
    "0.001",
    "--duration",
    "2.0",
    "--seed",
    "7",
    "--noise-std",
    "0.1",
    "--initial-offset-x",
    "0.0032",
    "--initial-offset-y",
    "-0.0024",
    "--initial-z",
    "0.020",
    "--target-x",
    "0.0032",
    "--target-y",
    "-0.0024",
    "--target-z",
    "-0.028",
    "--insertion-speed",
    "0.060",
    "--success-radial-factor",
    "1.05",
    "--success-depth",
    "0.015",
    "--stiffness-scale",
    "1.0",
    "--damping-scale",
    "1.0",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare canonical backend logs for the Vite frontend.",
    )
    parser.add_argument(
        "--force-benchmark",
        action="store_true",
        help="Always regenerate sweep CSVs via benchmark.",
    )
    parser.add_argument(
        "--full-benchmark",
        action="store_true",
        help="Run full benchmark sweep instead of quick mode.",
    )
    parser.add_argument(
        "--skip-benchmark",
        action="store_true",
        help="Do not run benchmark even if sweep files are missing.",
    )
    parser.add_argument(
        "--results-dir",
        type=str,
        default="results",
        help="Backend results directory.",
    )
    parser.add_argument(
        "--web-data-dir",
        type=str,
        default="web/public/data",
        help="Frontend data directory.",
    )
    return parser.parse_args()


def run_cmd(cmd: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, check=True)


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_canonical_runs(repo_root: Path) -> None:
    run_cmd(
        [
            sys.executable,
            "-m",
            "simulation.run_sim",
            "--mode",
            "stiff",
            *CANONICAL_SCENARIO_ARGS,
        ],
        cwd=repo_root,
    )
    run_cmd(
        [
            sys.executable,
            "-m",
            "simulation.run_sim",
            "--mode",
            "impedance",
            *CANONICAL_SCENARIO_ARGS,
        ],
        cwd=repo_root,
    )


def ensure_benchmark(
    repo_root: Path,
    results_dir: Path,
    force_benchmark: bool,
    full_benchmark: bool,
    skip_benchmark: bool,
) -> None:
    have_all = all((results_dir / name).exists() for name in REQUIRED_SWEEP_FILES)
    if skip_benchmark:
        if not have_all:
            missing = [name for name in REQUIRED_SWEEP_FILES if not (results_dir / name).exists()]
            raise FileNotFoundError(
                "Missing sweep files while --skip-benchmark is set: "
                + ", ".join(missing),
            )
        return

    if not force_benchmark and have_all:
        return

    cmd = [sys.executable, "-m", "experiments.benchmark"]
    if not full_benchmark:
        cmd.append("--quick")
        cmd.extend(["--num-seeds", "4", "--seed-start", "1"])
    run_cmd(cmd, cwd=repo_root)


def validate_canonical_story(results_dir: Path) -> dict[str, float | bool]:
    stiff_meta = load_json(results_dir / "run_stiff_meta.json")
    imp_meta = load_json(results_dir / "run_impedance_meta.json")

    stiff_summary = dict(stiff_meta["summary"])  # type: ignore[index]
    imp_summary = dict(imp_meta["summary"])  # type: ignore[index]

    stiff_success = bool(stiff_summary["success"])
    imp_success = bool(imp_summary["success"])
    stiff_peak = float(stiff_summary["peak_contact_force_n"])
    imp_peak = float(imp_summary["peak_contact_force_n"])
    imp_insert = imp_summary["insertion_time_s"]
    imp_insert_s = float(imp_insert) if imp_insert is not None else float("nan")

    checks = {
        "stiff_fails": not stiff_success,
        "impedance_succeeds": imp_success,
        "stiff_spikes_higher_force": stiff_peak > (imp_peak + 5.0),
        "impedance_inserts_under_1p5s": (not (imp_insert is None)) and imp_insert_s <= 1.5,
    }

    if not all(checks.values()):
        failed = [name for name, ok in checks.items() if not ok]
        raise RuntimeError(
            "Canonical validation failed: "
            + ", ".join(failed)
            + f" | stiff_peak={stiff_peak:.3f}N imp_peak={imp_peak:.3f}N "
            + f"imp_insert_s={imp_insert_s if imp_insert is not None else None}",
        )

    summary = {
        "stiff_success": stiff_success,
        "impedance_success": imp_success,
        "stiff_peak_contact_force_n": stiff_peak,
        "impedance_peak_contact_force_n": imp_peak,
        "impedance_insertion_time_s": imp_insert_s,
    }
    (results_dir / "phase4_validation.json").write_text(
        json.dumps(summary, indent=2),
        encoding="utf-8",
    )
    return summary


def sync_files(results_dir: Path, web_data_dir: Path) -> list[Path]:
    web_data_dir.mkdir(parents=True, exist_ok=True)
    files_to_copy = [
        *REQUIRED_TRACE_FILES,
        *REQUIRED_SWEEP_FILES,
        "benchmark_metadata.json",
        "phase4_validation.json",
    ]
    copied: list[Path] = []
    for name in files_to_copy:
        src = results_dir / name
        if src.exists():
            dst = web_data_dir / name
            shutil.copy2(src, dst)
            copied.append(dst)
    return copied


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    results_dir = (repo_root / args.results_dir).resolve()
    web_data_dir = (repo_root / args.web_data_dir).resolve()

    results_dir.mkdir(parents=True, exist_ok=True)
    ensure_canonical_runs(repo_root)
    ensure_benchmark(
        repo_root=repo_root,
        results_dir=results_dir,
        force_benchmark=bool(args.force_benchmark),
        full_benchmark=bool(args.full_benchmark),
        skip_benchmark=bool(args.skip_benchmark),
    )
    summary = validate_canonical_story(results_dir)
    copied = sync_files(results_dir, web_data_dir)

    print("Phase 4 canonical validation passed.")
    print(
        "Summary: "
        f"stiff_success={summary['stiff_success']} "
        f"impedance_success={summary['impedance_success']} "
        f"stiff_peak={summary['stiff_peak_contact_force_n']:.2f}N "
        f"imp_peak={summary['impedance_peak_contact_force_n']:.2f}N "
        f"imp_insert={summary['impedance_insertion_time_s']:.3f}s",
    )
    print(f"Synced {len(copied)} files to {web_data_dir.as_posix()}")
    for path in copied:
        print(f"- {path.as_posix()}")


if __name__ == "__main__":
    main()
