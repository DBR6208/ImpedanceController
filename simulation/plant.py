from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from .config import DEFAULT_CONTACT_CONFIG, ContactConfig


Vector3 = NDArray[np.float64]
Vector2 = NDArray[np.float64]


@dataclass(frozen=True)
class PlantState:
    """State snapshot for the simulated peg tip."""

    position_m: Vector3
    velocity_mps: Vector3


@dataclass(frozen=True)
class ContactWrench:
    """Contact output for logging and integration."""

    force_n: Vector3
    in_contact: bool
    penetration_m: float


@dataclass(frozen=True)
class StepResult:
    """Result payload from one plant step."""

    state: PlantState
    contact: ContactWrench
    disturbance_force_n: Vector3
    total_force_n: Vector3
    acceleration_mps2: Vector3


class PegInHolePlant:
    """Point-mass peg tip model integrated with semi-implicit Euler."""

    def __init__(
        self,
        mass_kg_xyz: tuple[float, float, float],
        dt_s: float,
        initial_position_m: tuple[float, float, float],
        initial_velocity_mps: tuple[float, float, float],
        contact: ContactConfig = DEFAULT_CONTACT_CONFIG,
        noise_std_n: float = 0.0,
        seed: int = 7,
    ) -> None:
        self._mass_kg = np.asarray(mass_kg_xyz, dtype=np.float64)
        self._inv_mass = 1.0 / self._mass_kg
        self._dt_s = float(dt_s)
        self._contact = contact
        self._noise_std_n = float(noise_std_n)
        self._rng = np.random.default_rng(seed)
        self._state = PlantState(
            position_m=np.asarray(initial_position_m, dtype=np.float64).copy(),
            velocity_mps=np.asarray(initial_velocity_mps, dtype=np.float64).copy(),
        )
        self._t_s = 0.0

    @property
    def t_s(self) -> float:
        return self._t_s

    @property
    def clearance_m(self) -> float:
        return self._contact.clearance_m

    @property
    def plate_z_m(self) -> float:
        return self._contact.plate_z_m

    @property
    def bottom_z_m(self) -> float:
        return self._contact.bottom_z_m

    @property
    def state(self) -> PlantState:
        """Returns defensive copies to prevent hidden external mutation."""
        return PlantState(
            position_m=self._state.position_m.copy(),
            velocity_mps=self._state.velocity_mps.copy(),
        )

    def step(self, commanded_force_n: Vector3) -> StepResult:
        """Advance one fixed-size step using semi-implicit Euler."""
        contact = self._compute_contact()
        disturbance_force = self._sample_disturbance()
        total_force = commanded_force_n + contact.force_n + disturbance_force
        acceleration = total_force * self._inv_mass

        v_next = self._state.velocity_mps + self._dt_s * acceleration
        x_next = self._state.position_m + self._dt_s * v_next

        self._state = PlantState(position_m=x_next, velocity_mps=v_next)
        self._t_s += self._dt_s

        return StepResult(
            state=self.state,
            contact=contact,
            disturbance_force_n=disturbance_force,
            total_force_n=total_force.copy(),
            acceleration_mps2=acceleration.copy(),
        )

    def _sample_disturbance(self) -> Vector3:
        if self._noise_std_n <= 0.0:
            return np.zeros(3, dtype=np.float64)
        return self._rng.normal(0.0, self._noise_std_n, size=3).astype(np.float64)

    def _compute_contact(self) -> ContactWrench:
        pos = self._state.position_m
        vel = self._state.velocity_mps

        xy: Vector2 = pos[:2]
        v_xy: Vector2 = vel[:2]
        radial_norm = float(np.linalg.norm(xy))
        radial_pen = max(0.0, radial_norm - self._contact.clearance_m)
        z_pen = max(0.0, self._contact.plate_z_m - pos[2])

        force = np.zeros(3, dtype=np.float64)
        in_contact = False
        penetration = 0.0

        if radial_pen > 0.0 and z_pen > 0.0:
            in_contact = True
            penetration = max(radial_pen, z_pen)
            if radial_norm > 1e-12:
                radial_dir = xy / radial_norm
                radial_velocity = float(np.dot(v_xy, radial_dir))
            else:
                radial_dir = np.zeros(2, dtype=np.float64)
                radial_velocity = 0.0

            inward_force_mag = (
                self._contact.radial_stiffness_npm * radial_pen
                + self._contact.radial_damping_nspm * max(0.0, radial_velocity)
                + self._contact.centering_stiffness_npmm * radial_pen * z_pen
            )
            force[:2] = -inward_force_mag * radial_dir

            upward_force_mag = (
                self._contact.vertical_stiffness_npm * z_pen
                + self._contact.vertical_damping_nspm * max(0.0, -vel[2])
            )
            force[2] += upward_force_mag

        bottom_pen = max(0.0, self._contact.bottom_z_m - pos[2])
        if bottom_pen > 0.0:
            in_contact = True
            penetration = max(penetration, bottom_pen)
            force[2] += (
                self._contact.bottom_stiffness_npm * bottom_pen
                + self._contact.bottom_damping_nspm * max(0.0, -vel[2])
            )

        return ContactWrench(force_n=force, in_contact=in_contact, penetration_m=penetration)
