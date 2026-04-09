from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
from numpy.typing import NDArray

from .config import (
    DEFAULT_CONTROLLER_PRESETS,
    ControllerMode,
    ControllerPreset,
    SimulationConfig,
    TrajectoryConfig,
)

if TYPE_CHECKING:
    from .plant import PlantState


Vector3 = NDArray[np.float64]


@dataclass(frozen=True)
class ControlOutput:
    """Controller output for one integration step."""

    reference_position_m: Vector3
    spring_force_n: Vector3
    damping_force_n: Vector3
    commanded_force_n: Vector3


class ImpedanceController:
    """Diagonal spring-damper controller with insertion trajectory."""

    def __init__(
        self,
        preset: ControllerPreset,
        trajectory: TrajectoryConfig,
        stiffness_scale: float = 1.0,
        damping_scale: float = 1.0,
    ) -> None:
        self.mass_kg = np.asarray(preset.mass_xyz, dtype=np.float64)
        self.stiffness_npm = (
            np.asarray(preset.stiffness_xyz, dtype=np.float64) * stiffness_scale
        )
        self.damping_nspm = np.asarray(preset.damping_xyz, dtype=np.float64) * damping_scale
        self.trajectory = trajectory

    def reference_at(self, t_s: float) -> Vector3:
        """Monotonic insertion reference along z with fixed xy target."""
        target_x, target_y = self.trajectory.target_xy_m
        z_ref = self.trajectory.start_z_m - self.trajectory.insertion_speed_mps * t_s
        z_ref = max(self.trajectory.target_z_m, z_ref)
        return np.asarray([target_x, target_y, z_ref], dtype=np.float64)

    def compute(self, state: PlantState, t_s: float) -> ControlOutput:
        x_ref = self.reference_at(t_s)
        position_error = state.position_m - x_ref
        spring_force = -self.stiffness_npm * position_error
        damping_force = -self.damping_nspm * state.velocity_mps
        commanded_force = spring_force + damping_force
        return ControlOutput(
            reference_position_m=x_ref,
            spring_force_n=spring_force,
            damping_force_n=damping_force,
            commanded_force_n=commanded_force,
        )


def build_controller(config: SimulationConfig) -> ImpedanceController:
    """Factory that returns either stiff or impedance preset."""
    preset = DEFAULT_CONTROLLER_PRESETS[config.mode]
    trajectory = TrajectoryConfig(
        target_xy_m=config.target_xy_m,
        start_z_m=config.initial_position_m[2],
        target_z_m=config.target_z_m,
        insertion_speed_mps=config.insertion_speed_mps,
    )
    return ImpedanceController(
        preset=preset,
        trajectory=trajectory,
        stiffness_scale=config.stiffness_scale,
        damping_scale=config.damping_scale,
    )


def parse_mode(mode: str) -> ControllerMode:
    normalized = mode.strip().lower()
    try:
        return ControllerMode(normalized)
    except ValueError as exc:
        supported = ", ".join(sorted(member.value for member in ControllerMode))
        raise ValueError(f"Unsupported mode '{mode}'. Supported: {supported}") from exc
