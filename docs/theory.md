# Impedance Alignment Theory Notes

## 1) Problem setup
We study peg insertion with lateral offset uncertainty. The peg starts above the plate with an XY offset and moves downward toward the hole.

Two controllers are compared under identical initial conditions:
- `stiff`: high translational stiffness, low damping
- `impedance`: lower translational stiffness, higher damping/compliance

Target behavior:
- stiff controller shows contact spikes and poor insertion robustness
- impedance controller shows compliant contact, self-centering, and successful insertion

## 1.1) Control architecture diagram
![Control architecture diagram](assets/diagrams/controller_block.svg)

[Open control architecture diagram](assets/diagrams/controller_block.svg)

## 2) Core dynamics model
The commanded task-space dynamics follow a diagonal spring-mass-damper structure:

\[
M \ddot{x} + D \dot{x} + K(x - x_{\text{ref}}) = F_{\text{contact}} + w
\]

where:
- \(x = [x, y, z]^T\): peg position
- \(x_{\text{ref}}\): insertion trajectory reference
- \(M, D, K\): virtual mass, damping, stiffness (diagonal in this demo)
- \(F_{\text{contact}}\): contact reaction force from hole/plate
- \(w\): force noise term (Gaussian, deterministic seed for reproducibility)

The controller command used in simulation is:

\[
F_{\text{cmd}} = -K(x - x_{\text{ref}}) - D \dot{x}
\]

and total force is:

\[
F_{\text{total}} = F_{\text{cmd}} + F_{\text{contact}} + w
\]

## 3) Reference trajectory
The reference keeps XY fixed at the initial offset and drives Z downward at constant speed until a target depth:

\[
z_{\text{ref}}(t) = \max(z_{\text{target}}, z_0 - v_{\text{insert}} t)
\]

This is intentionally simple so contact behavior dominates the comparison.

## 4) Contact model (penalty + centering effect)
Contact is modeled with radial and vertical penalties around the hole geometry.

Definitions:
- clearance: \(c = r_{\text{hole}} - r_{\text{peg}}\)
- radial distance: \(r = \sqrt{x^2 + y^2}\)
- radial penetration: \(p_r = \max(0, r - c)\)
- top-plane penetration: \(p_z = \max(0, z_{\text{plate}} - z)\)

When \(p_r > 0\) and \(p_z > 0\), lateral inward force magnitude includes:
- radial stiffness term
- radial damping term
- extra centering term proportional to \(p_r p_z\)

That centering term emulates the “funnel/self-guiding” effect after rim contact.

A bottom-stop penalty is also applied near hole bottom depth.

## 5) Numerical integration
Simulation uses fixed-step semi-implicit Euler:

1. \(\dot{x}_{k+1} = \dot{x}_k + \Delta t \, M^{-1} F_{\text{total},k}\)
2. \(x_{k+1} = x_k + \Delta t \, \dot{x}_{k+1}\)

Why semi-implicit Euler:
- stable for damped mechanical systems at small fixed \(\Delta t\)
- deterministic and simple for pedagogical comparison
- no hidden state mutation outside the plant step

## 6) Success metric and force-spike metric
Insertion success at a time step is declared when both hold:
- radial error is within a scaled clearance band
- Z depth reaches below success depth threshold

In symbols:

\[
\sqrt{x^2+y^2} \le \alpha c,\quad z \le z_{\text{plate}} - d_{\text{success}}
\]

Primary comparison metrics:
- peak contact force
- insertion time (first success time)
- success/failure rate across seeds

## 7) Why impedance reduces spikes (intuition)
High stiffness behaves like a hard virtual spring:
- small contact deflection creates large restoring force
- impact-like interactions produce force peaks and oscillation

Impedance tuning (lower K, higher D in lateral axes) behaves like a compliant interface:
- contact energy is dissipated rather than amplified
- peg can slide along constraints
- lateral error decays while descending, enabling insertion

## 8) Week 6 control linkage
This demo maps directly to Week 6 themes:
- task-space impedance as virtual mechanical behavior
- contact transition from free-space to constrained motion
- compliance as a robustness mechanism under geometric uncertainty
- force spike analysis as a safety/stability concern

## 9) Interpreting project plots
- force vs time: proof of spike reduction in impedance mode
- center error vs time: oscillatory/stuck versus convergent behavior
- stiffness sweep: force/robustness tradeoff as K changes
- damping sweep: oscillation and insertion-time sensitivity
- success heatmap: robustness across stiffness and initial offset

## 10) Assumptions and limitations
- reduced-order point-mass peg model (not 6-DOF wrench dynamics)
- penalty contact model (no full Coulomb friction cone/stick-slip ID)
- no explicit torque/wrist compliance coupling
- no sensor latency or actuator saturation model

These simplifications are intentional for fast, clear control insight.

## 11) Forward path
- 6-DOF manipulator wrist impedance with orientation coupling
- nonlinear friction/contact models
- hybrid motion-force switching and/or MPC baseline
- ROS2 streaming and hardware-in-the-loop integration
