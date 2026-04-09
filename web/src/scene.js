import * as THREE from "three";

const WORLD_SCALE = 56.0;
const PEG_RADIUS_M = 0.0090;
const PEG_LENGTH_M = 0.06;
const HOLE_RADIUS_M = 0.0105;
const PLATE_SIZE_M = 0.08;
const PLATE_THICKNESS_M = 0.006;

function simToWorldPosition(xM, yM, zM) {
  return new THREE.Vector3(xM * WORLD_SCALE, zM * WORLD_SCALE, yM * WORLD_SCALE);
}

function simToWorldVector(fxN, fyN, fzN) {
  return new THREE.Vector3(fxN, fzN, fyN);
}

function setLinePoints(line, from, to) {
  const position = line.geometry.attributes.position;
  position.setXYZ(0, from.x, from.y, from.z);
  position.setXYZ(1, to.x, to.y, to.z);
  position.needsUpdate = true;
}

class PanelView {
  constructor({ background, pegColor, trailColor, forceColor, springColor }) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(background);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.cameraOffset = new THREE.Vector3(0.0, 5.7, 13.8);
    this.focusPoint = new THREE.Vector3(0.0, 0.0, 0.0);
    this.camera.position.copy(this.cameraOffset);
    this.camera.lookAt(this.focusPoint);

    this.trace = null;
    this.maxTrailPoints = 1;

    this._buildStaticWorld({ pegColor, trailColor, forceColor, springColor });
  }

  _buildStaticWorld({ pegColor, trailColor, forceColor, springColor }) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.62);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.86);
    key.position.set(8, 14, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88ccff, 0.32);
    rim.position.set(-8, 6, -8);
    this.scene.add(rim);

    const plateGeometry = new THREE.BoxGeometry(
      PLATE_SIZE_M * WORLD_SCALE,
      PLATE_THICKNESS_M * WORLD_SCALE,
      PLATE_SIZE_M * WORLD_SCALE,
    );
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0x274d64,
      metalness: 0.22,
      roughness: 0.68,
    });
    this.plate = new THREE.Mesh(plateGeometry, plateMaterial);
    this.plate.position.y = -0.5 * PLATE_THICKNESS_M * WORLD_SCALE;
    this.scene.add(this.plate);

    const holeRing = new THREE.RingGeometry(
      PEG_RADIUS_M * WORLD_SCALE,
      HOLE_RADIUS_M * WORLD_SCALE,
      48,
    );
    const holeMaterial = new THREE.MeshBasicMaterial({
      color: 0x9ad5e6,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    this.hole = new THREE.Mesh(holeRing, holeMaterial);
    this.hole.rotation.x = -Math.PI * 0.5;
    this.hole.position.y = 0.01;
    this.scene.add(this.hole);

    const guideGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-2.2, 0.02, 0),
      new THREE.Vector3(2.2, 0.02, 0),
      new THREE.Vector3(0, 0.02, -2.2),
      new THREE.Vector3(0, 0.02, 2.2),
    ]);
    const guides = new THREE.LineSegments(
      guideGeom,
      new THREE.LineBasicMaterial({ color: 0x79b8ca, transparent: true, opacity: 0.45 }),
    );
    this.scene.add(guides);

    const pegGeometry = new THREE.CylinderGeometry(
      PEG_RADIUS_M * WORLD_SCALE,
      PEG_RADIUS_M * WORLD_SCALE,
      PEG_LENGTH_M * WORLD_SCALE,
      24,
    );
    const pegMaterial = new THREE.MeshStandardMaterial({
      color: pegColor,
      metalness: 0.26,
      roughness: 0.36,
      emissive: 0x000000,
    });
    this.peg = new THREE.Mesh(pegGeometry, pegMaterial);
    this.scene.add(this.peg);

    this.successGlow = new THREE.Mesh(
      new THREE.TorusGeometry(HOLE_RADIUS_M * WORLD_SCALE * 1.14, 0.08, 12, 64),
      new THREE.MeshBasicMaterial({
        color: 0x56e39f,
        transparent: true,
        opacity: 0.0,
      }),
    );
    this.successGlow.rotation.x = -Math.PI * 0.5;
    this.successGlow.position.y = 0.03;
    this.scene.add(this.successGlow);

    const springGeometry = new THREE.BufferGeometry();
    springGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    this.spring = new THREE.Line(
      springGeometry,
      new THREE.LineBasicMaterial({ color: springColor, linewidth: 2 }),
    );
    this.scene.add(this.spring);

    this.forceArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      0.1,
      forceColor,
      0.3,
      0.2,
    );
    this.forceArrow.visible = false;
    this.scene.add(this.forceArrow);

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(3), 3),
    );
    this.trail = new THREE.Line(
      this.trailGeometry,
      new THREE.LineBasicMaterial({
        color: trailColor,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.scene.add(this.trail);
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setTrace(trace) {
    this.trace = trace;
    if (!trace) {
      return;
    }
    const last = trace.steps - 1;
    const focusX = 0.5 * (trace.xRefM[0] + trace.xRefM[last]) * WORLD_SCALE;
    const focusZ = 0.5 * (trace.yRefM[0] + trace.yRefM[last]) * WORLD_SCALE;
    this.focusPoint.set(focusX, -0.12, focusZ);
    this.camera.position
      .copy(this.focusPoint)
      .add(this.cameraOffset);
    this.camera.lookAt(this.focusPoint);

    const positions = new Float32Array(trace.steps * 3);
    for (let i = 0; i < trace.steps; i += 1) {
      const tip = simToWorldPosition(trace.xM[i], trace.yM[i], trace.zM[i]);
      positions[i * 3 + 0] = tip.x;
      positions[i * 3 + 1] = tip.y;
      positions[i * 3 + 2] = tip.z;
    }
    this.maxTrailPoints = trace.steps;
    this.trailGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.computeBoundingSphere();
    this.trailGeometry.setDrawRange(0, 1);
  }

  update(index) {
    if (!this.trace || this.trace.steps <= 0) {
      return;
    }
    const i = Math.max(0, Math.min(index, this.trace.steps - 1));
    const tip = simToWorldPosition(this.trace.xM[i], this.trace.yM[i], this.trace.zM[i]);
    const ref = simToWorldPosition(
      this.trace.xRefM[i],
      this.trace.yRefM[i],
      this.trace.zRefM[i],
    );

    this.peg.position.set(
      tip.x,
      tip.y + 0.5 * PEG_LENGTH_M * WORLD_SCALE,
      tip.z,
    );
    setLinePoints(this.spring, ref, tip);

    const springCompression = ref.distanceTo(tip);
    this.spring.material.color.setHex(
      springCompression > 0.25 ? 0xf0b35e : 0x8fd6e8,
    );

    const forceVector = simToWorldVector(
      this.trace.contactFxN[i],
      this.trace.contactFyN[i],
      this.trace.contactFzN[i],
    );
    const forceMag = forceVector.length();
    if (forceMag > 1e-5) {
      this.forceArrow.visible = true;
      this.forceArrow.position.copy(tip);
      this.forceArrow.setDirection(forceVector.clone().normalize());
      this.forceArrow.setLength(
        Math.min(3.8, 0.07 * forceMag + 0.08),
        0.35,
        0.25,
      );
    } else {
      this.forceArrow.visible = false;
    }

    this.trailGeometry.setDrawRange(0, Math.max(2, Math.min(i + 1, this.maxTrailPoints)));

    const isSuccess = this.trace.success[i] > 0;
    this.successGlow.material.opacity = isSuccess ? 0.65 : 0.04;
  }
}

export function createSplitScene(hostElement) {
  hostElement.style.display = "flex";
  hostElement.style.width = "100%";
  hostElement.style.height = "100%";
  hostElement.style.alignItems = "stretch";

  const leftViewport = document.createElement("div");
  leftViewport.style.flex = "1 1 50%";
  leftViewport.style.height = "100%";
  leftViewport.style.minWidth = "0";
  const rightViewport = document.createElement("div");
  rightViewport.style.flex = "1 1 50%";
  rightViewport.style.height = "100%";
  rightViewport.style.minWidth = "0";
  hostElement.append(leftViewport, rightViewport);

  const leftRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  leftRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  leftRenderer.outputColorSpace = THREE.SRGBColorSpace;
  leftRenderer.setClearAlpha(1.0);
  leftViewport.appendChild(leftRenderer.domElement);

  const rightRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  rightRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  rightRenderer.outputColorSpace = THREE.SRGBColorSpace;
  rightRenderer.setClearAlpha(1.0);
  rightViewport.appendChild(rightRenderer.domElement);

  const leftPanel = new PanelView({
    background: 0x0b1522,
    pegColor: 0xff8a80,
    trailColor: 0xffb3a8,
    forceColor: 0xff7f79,
    springColor: 0xf0b35e,
  });
  const rightPanel = new PanelView({
    background: 0x091821,
    pegColor: 0x5fe1a9,
    trailColor: 0x8df2cb,
    forceColor: 0x56e39f,
    springColor: 0x8fd6e8,
  });

  let viewMode = "split";

  function layoutViewports() {
    if (viewMode === "split") {
      leftViewport.style.display = "";
      rightViewport.style.display = "";
      leftViewport.style.flexBasis = "50%";
      rightViewport.style.flexBasis = "50%";
      return;
    }
    if (viewMode === "stiff") {
      leftViewport.style.display = "";
      rightViewport.style.display = "none";
      leftViewport.style.flexBasis = "100%";
      return;
    }
    leftViewport.style.display = "none";
    rightViewport.style.display = "";
    rightViewport.style.flexBasis = "100%";
  }

  function renderViewport(renderer, viewportElement, panel, frameIndex) {
    if (!viewportElement.offsetParent) {
      return;
    }
    const width = Math.max(1, viewportElement.clientWidth);
    const height = Math.max(1, viewportElement.clientHeight);
    renderer.setSize(width, height, false);
    panel.resize(width, height);
    panel.update(frameIndex);
    renderer.render(panel.scene, panel.camera);
  }

  function render(frameLeft, frameRight) {
    layoutViewports();

    if (viewMode === "split") {
      renderViewport(leftRenderer, leftViewport, leftPanel, frameLeft);
      renderViewport(rightRenderer, rightViewport, rightPanel, frameRight);
      return;
    }
    if (viewMode === "stiff") {
      renderViewport(leftRenderer, leftViewport, leftPanel, frameLeft);
      return;
    }
    renderViewport(rightRenderer, rightViewport, rightPanel, frameRight);
  }

  function setViewMode(mode) {
    viewMode = mode;
    layoutViewports();
  }

  function setTraces({ stiff, impedance }) {
    leftPanel.setTrace(stiff);
    rightPanel.setTrace(impedance);
  }

  function dispose() {
    leftRenderer.dispose();
    rightRenderer.dispose();
    if (leftViewport.parentElement === hostElement) {
      hostElement.removeChild(leftViewport);
    }
    if (rightViewport.parentElement === hostElement) {
      hostElement.removeChild(rightViewport);
    }
  }

  return {
    render,
    setViewMode,
    setTraces,
    dispose,
  };
}

export const SCENE_CONSTANTS = {
  worldScale: WORLD_SCALE,
  pegRadiusM: PEG_RADIUS_M,
  holeRadiusM: HOLE_RADIUS_M,
  plateZM: 0.0,
};
