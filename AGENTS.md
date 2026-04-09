# AGENTS.md

# Project: Impedance-Controlled Alignment Demo

# Goal: MIT-grade robotics control demo with Python simulation backend + Vite + Three.js 3D frontend

## Project Objective

Build a clean GitHub-quality robotics demo that illustrates:

1. stiff position control collision
2. impedance-controlled compliant alignment
3. self-centering peg insertion into a hole under positional uncertainty

The demo must clearly communicate Week 6 control concepts:

* impedance control
* hybrid contact transition
* force spikes
* compliance
* self-alignment
* robustness to uncertainty

The project should feel like a miniature robotics research artifact.

A user should understand the control insight in **under 10 seconds**:

> stiff control collides and spikes force, while impedance control softly self-aligns and inserts.

---

# SYSTEM DESIGN

The project is split into 4 agents.

---

## Agent 1 — Dynamics & Control Engineer

### Responsibility

Implement the simulation plant and controller in Python.

### Deliverables

* `simulation/plant.py`
* `simulation/controller.py`
* `simulation/run_sim.py`

### Core Model

Model peg tip as 2D or 3D point-mass spring-damper system:

M x_ddot + D x_dot + K (x - x_ref) = F_contact

Where:

* M = virtual mass
* D = damping matrix
* K = stiffness matrix
* x_ref = insertion trajectory
* F_contact = hole wall reaction force

### Requirements

* support stiff position control baseline
* support impedance mode
* configurable stiffness and damping
* collision/contact force model
* insertion success metric
* force spike logging
* simulation noise option
* deterministic random seed
* CSV logging

### Numerical Requirements

* fixed timestep integration
* stable semi-implicit Euler
* configurable dt
* no hidden state mutation outside `step()`

---

## Agent 2 — Visualization Engineer

### Responsibility

Build interactive **Vite + Three.js frontend**.

### Deliverables

* `web/index.html`
* `web/src/main.js`
* `web/src/scene.js`
* `web/src/ui.js`
* `web/vite.config.js`

## Phase 1 → primitives only (MANDATORY MVP)

The first visualization milestone must use **procedural Three.js primitives only**.

### Allowed MVP primitives

* peg = `CylinderGeometry`
* plate = `BoxGeometry`
* hole = `RingGeometry` or visual cutout approximation
* spring = `TubeGeometry` or `Line`
* force vectors = `ArrowHelper`
* contact guides = `LineSegments`
* peg trail = `Line`

### Why this phase matters

The purpose of Phase 1 is fast validation of:

* control behavior
* collision logic
* self-alignment
* compliance visualization
* force spikes

No external CAD/GLB assets are allowed in Phase 1.
Realism upgrades come only after the controller behavior is correct.

### Vite Frontend Requirements

* use Vite for dev server + bundling
* ES module structure
* hot reload for scene tuning
* reusable scene setup module
* reusable controls/ui module
* split-screen comparison layout support

### Core Visual Story (MANDATORY)

The visualization must instantly compare:

* **stiff position control** → rim collision, oscillation, force spike
* **impedance control** → compliant contact, sliding, self-centering, insertion

The frontend should make this understandable in **10 seconds or less**.

### Must-Have Visualizations

#### 1) Hero 3D insertion scene

Main side-perspective scene showing:

* vertical peg / screwdriver shaft
* hole plate
* visible initial lateral offset
* peg trajectory trail
* contact force arrows
* spring compression indicator
* green success glow on insertion

#### 2) Top-down alignment inset

Educational top view showing:

* peg circle
* hole circle
* lateral error vector
* sliding-to-center path
* contact normals

#### 3) Force vs time plot

Quantitative proof plot with:

* stiff control force curve
* impedance force curve
* peak force annotation

#### 4) Displacement error plot

Show lateral alignment error convergence:

* stiff = oscillatory
* impedance = exponential decay

#### 5) Stiffness sweep plot

Plot:

* stiffness vs peak force
* stiffness vs success rate
* stiffness vs settling time

#### 6) Damping sweep plot

Plot:

* damping vs oscillation magnitude
* damping vs insertion time

#### 7) Success-rate heatmap

Axes:

* x = stiffness
* y = initial lateral offset
* color = insertion success rate

### Split-Screen Comparison (HIGH PRIORITY)

The most important UX feature is side-by-side playback:

* left = stiff control
* right = impedance control

Same initial conditions must be used.
This is the fastest way to communicate the control advantage.

### Animation Requirements

* playback from logged CSV/JSON
* scrub timeline slider
* play/pause/reset
* stiffness slider
* damping slider
* noise slider
* controller mode toggle
* split-screen sync playback

### UX Goal

The user should instantly understand:

* stiff → collision spike
* soft → guided insertion
* stiffness tuning tradeoffs

---

## Agent 3 — Experimentation & Benchmark Engineer

### Responsibility

Generate comparison experiments.

### Deliverables

* `experiments/benchmark.py`
* `results/*.csv`
* `plots/*.png`

### Required Experiments

1. stiffness sweep
2. damping sweep
3. lateral offset robustness
4. noise robustness
5. force spike comparison
6. insertion success rate
7. success heatmap generation

### Required Outputs

* force vs time
* displacement vs time
* success/failure bar chart
* overshoot plot
* settling time plot
* stiffness tradeoff plot
* damping tradeoff plot
* robustness heatmap

---

## Agent 4 — Documentation & Storytelling Engineer

### Responsibility

Make project MIT-workbook and GitHub ready.

### Deliverables

* `README.md`
* `docs/theory.md`
* `notebooks/demo.ipynb`

### Documentation Must Explain

* why impedance avoids force spikes
* relation to Week 6 control lecture
* spring-mass-damper intuition
* natural constraints during insertion
* why compliance improves observability
* comparison to stiff control
* equations used
* limitations
* future upgrade path to 6-DOF manipulator wrist control
* Phase 1 primitive-only visualization rationale
* future Phase 2 GLB/CAD realism path
* how to interpret each plot and sweep
* why split-screen comparison matters pedagogically

### README Quality Bar

Should feel like:

* MIT robotics coursework extension
* research prototype
* recruiter-friendly robotics portfolio piece

---

# RECOMMENDED REPO STRUCTURE

```text
impedance-alignment-demo/
│
├── AGENTS.md
├── README.md
├── simulation/
│   ├── plant.py
│   ├── controller.py
│   └── run_sim.py
│
├── experiments/
│   └── benchmark.py
│
├── web/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.js
│       ├── scene.js
│       ├── ui.js
│       └── plots.js
│
├── notebooks/
│   └── demo.ipynb
│
└── results/
```

---

# CODING STANDARDS

* Python: typed, modular, clean OOP
* JS: ES modules through Vite
* no duplicated control logic
* clear docstrings
* reproducible experiments
* deterministic seeds
* all constants centralized in config
* use matplotlib for backend plots
* use Three.js for 3D only
* frontend plots should support live replay overlays
* no heavy frameworks unless necessary

---

# STRETCH GOALS

If time permits:

* Phase 2 GLB screwdriver mesh swap
* nonlinear friction cone contact
* hybrid motion-force mode switch
* explicit MPC baseline
* ROS2 topic streaming mode
* 6-axis wrench visualization
* UR5 wrist mount mesh
* screw thread helix animation
* torque ramp near seating

---

# DEFINITION OF DONE

The demo is complete when:

1. stiff control visibly causes force spikes
2. impedance control self-aligns and inserts
3. Phase 1 primitives clearly show the behavior
4. split-screen comparison is obvious and compelling
5. plots quantitatively prove force reduction
6. sweeps quantify robustness gains
7. Vite + Three.js scene is interactive and polished
8. README explains robotics relevance
9. project is portfolio-ready
