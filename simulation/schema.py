from __future__ import annotations

from dataclasses import asdict, dataclass, fields


@dataclass(frozen=True)
class StepLog:
    """Canonical per-step schema for CSV playback and analysis."""

    t_s: float
    mode: str
    success: int
    in_contact: int
    x_m: float
    y_m: float
    z_m: float
    vx_mps: float
    vy_mps: float
    vz_mps: float
    x_ref_m: float
    y_ref_m: float
    z_ref_m: float
    lateral_error_m: float
    control_fx_n: float
    control_fy_n: float
    control_fz_n: float
    contact_fx_n: float
    contact_fy_n: float
    contact_fz_n: float
    contact_force_n: float
    total_force_n: float
    penetration_m: float

    def to_row(self) -> dict[str, float | int | str]:
        return asdict(self)


CSV_COLUMNS: tuple[str, ...] = tuple(field.name for field in fields(StepLog))

