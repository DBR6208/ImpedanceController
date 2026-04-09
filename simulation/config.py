from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ControllerMode(str, Enum):
    """Supported controller variants."""

    STIFF = "stiff"
    IMPEDANCE = "impedance"


@dataclass(frozen=True)
class ControllerPreset:
    """Diagonal virtual dynamics terms for one controller mode."""

    mass_xyz: tuple[float, float, float]
    stiffness_xyz: tuple[float, float, float]
    damping_xyz: tuple[float, float, float]


@dataclass(frozen=True)
class ContactConfig:
    """Penalty-based contact model parameters."""

    hole_radius_m: float = 0.0105
    peg_radius_m: float = 0.0090
    plate_z_m: float = 0.0
    hole_depth_m: float = 0.030
    radial_stiffness_npm: float = 6000.0
    radial_damping_nspm: float = 35.0
    centering_stiffness_npmm: float = 350000.0
    vertical_stiffness_npm: float = 2200.0
    vertical_damping_nspm: float = 20.0
    bottom_stiffness_npm: float = 30000.0
    bottom_damping_nspm: float = 80.0

    @property
    def clearance_m(self) -> float:
        """Radial clearance between peg and hole."""
        return self.hole_radius_m - self.peg_radius_m

    @property
    def bottom_z_m(self) -> float:
        """Hole bottom plane along z."""
        return self.plate_z_m - self.hole_depth_m


@dataclass(frozen=True)
class TrajectoryConfig:
    """Reference insertion trajectory."""

    target_xy_m: tuple[float, float] = (0.0032, -0.0024)
    start_z_m: float = 0.020
    target_z_m: float = -0.028
    insertion_speed_mps: float = 0.030


@dataclass(frozen=True)
class SimulationConfig:
    """Global run configuration shared by simulation entrypoints."""

    mode: ControllerMode = ControllerMode.IMPEDANCE
    duration_s: float = 2.0
    dt_s: float = 0.001
    seed: int = 7
    noise_std_n: float = 0.1
    initial_position_m: tuple[float, float, float] = (0.0032, -0.0024, 0.020)
    initial_velocity_mps: tuple[float, float, float] = (0.0, 0.0, 0.0)
    target_xy_m: tuple[float, float] = (0.0032, -0.0024)
    target_z_m: float = -0.028
    insertion_speed_mps: float = 0.060
    success_radial_factor: float = 1.05
    success_depth_m: float = 0.015
    stiffness_scale: float = 1.0
    damping_scale: float = 1.0


DEFAULT_CONTROLLER_PRESETS: dict[ControllerMode, ControllerPreset] = {
    ControllerMode.STIFF: ControllerPreset(
        mass_xyz=(0.40, 0.40, 0.50),
        stiffness_xyz=(6200.0, 6200.0, 18000.0),
        damping_xyz=(14.0, 14.0, 26.0),
    ),
    ControllerMode.IMPEDANCE: ControllerPreset(
        mass_xyz=(0.40, 0.40, 0.50),
        stiffness_xyz=(90.0, 90.0, 3200.0),
        damping_xyz=(70.0, 70.0, 120.0),
    ),
}

DEFAULT_CONTACT_CONFIG = ContactConfig()
DEFAULT_TRAJECTORY_CONFIG = TrajectoryConfig()
DEFAULT_SIM_CONFIG = SimulationConfig()
