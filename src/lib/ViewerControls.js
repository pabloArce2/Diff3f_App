import * as THREE from "three";

const ROTATION_PER_PIXEL = 0.008;
const ZOOM_PER_WHEEL_PIXEL = 0.001;
const CLICK_TOLERANCE = 4;
const DEFAULT_YAW = -0.15;
const DEFAULT_PITCH = -0.65;

// Camera controls shared by both viewers: drag to rotate, shift/right/middle-drag to pan,
// wheel to zoom towards the cursor, F to fit. A press that moves less than CLICK_TOLERANCE
// pixels counts as a click (used for picking points).
export class ViewerControls {
  constructor(camera, domElement, options = {}) {
    if (!camera?.isPerspectiveCamera) throw new Error("ViewerControls requires a PerspectiveCamera.");
    this.camera = camera;
    this.domElement = domElement;
    this.onChange = options.onChange || (() => {});
    this.onClick = options.onClick || (() => {});
    this.onEscape = options.onEscape || (() => {});
    this.enabled = true;
    this.yaw = options.yaw ?? DEFAULT_YAW;
    this.pitch = options.pitch ?? DEFAULT_PITCH;
    this.width = 1;
    this.height = 1;
    this.radius = 1;
    this.distance = 4;
    this.fitDistance = 4;
    this.minDistanceRatio = options.minDistanceRatio ?? 0.1;
    this.maxDistanceRatio = options.maxDistanceRatio ?? 20;
    this.minDistance = this.radius * this.minDistanceRatio;
    this.maxDistance = this.radius * this.maxDistanceRatio;
    this.center = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.panX = 0;
    this.panY = 0;
    this.bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    this.pointer = null;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);

    domElement.style.touchAction = "none";
    domElement.style.cursor = "grab";
    domElement.addEventListener("pointerdown", this.handlePointerDown);
    domElement.addEventListener("pointermove", this.handlePointerMove);
    domElement.addEventListener("pointerup", this.handlePointerUp);
    domElement.addEventListener("pointercancel", this.handlePointerCancel);
    domElement.addEventListener("lostpointercapture", this.handlePointerCancel);
    domElement.addEventListener("wheel", this.handleWheel, { passive: false });
    domElement.addEventListener("contextmenu", this.handleContextMenu);
    domElement.addEventListener("keydown", this.handleKeyDown);
    this.updateCamera(false);
  }

  setViewport(width, height) {
    this.width = Math.max(1, Number(width) || 1);
    this.height = Math.max(1, Number(height) || 1);
    this.camera.aspect = this.width / this.height;
    this.updateCamera();
  }

  setBounds(
    bounds,
    minDistanceRatio = this.minDistanceRatio,
    maxDistanceRatio = this.maxDistanceRatio,
  ) {
    if (!bounds || bounds.isEmpty()) return;
    this.bounds.copy(bounds);
    const sphere = this.bounds.getBoundingSphere(new THREE.Sphere());
    this.radius = Math.max(sphere.radius || 1, 0.001);
    this.minDistanceRatio = minDistanceRatio;
    this.maxDistanceRatio = maxDistanceRatio;
    this.minDistance = this.radius * this.minDistanceRatio;
    this.maxDistance = this.radius * this.maxDistanceRatio;
    this.updateClipping();
  }

  fit(bounds = this.bounds) {
    this.setBounds(bounds);
    this.center.copy(this.bounds.getCenter(new THREE.Vector3()));
    this.panX = 0;
    this.panY = 0;
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const limitingFov = Math.max(0.1, Math.min(verticalFov, horizontalFov));
    this.distance = (this.radius / Math.sin(limitingFov / 2)) * 1.08;
    this.fitDistance = this.distance;
    this.minDistance = Math.min(this.minDistance, this.fitDistance / 25);
    this.maxDistance = Math.max(this.maxDistance, this.fitDistance * 10);
    this.updateCamera();
  }

  setView(yaw, pitch, fit = true) {
    this.yaw = Number(yaw) || 0;
    this.pitch = Number(pitch) || 0;
    if (fit) this.fit();
    else this.updateCamera();
  }

  rotateByRadians(yawDelta, pitchDelta = 0) {
    this.yaw += yawDelta;
    this.pitch += pitchDelta;
    this.updateCamera();
  }

  focus(worldPoint) {
    if (!worldPoint) return;
    this.center.copy(worldPoint);
    this.panX = 0;
    this.panY = 0;
    this.updateCamera();
  }

  getState() {
    return {
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.distance,
      center: this.center.toArray(),
      target: this.target.toArray(),
      pan: [this.panX, this.panY],
    };
  }

  viewQuaternion() {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    return pitch.multiply(yaw);
  }

  updateClipping() {
    this.camera.near = Math.max(this.radius / 1000, 0.0001);
    this.camera.far = Math.max(this.distance + this.radius * 10, 100);
    this.camera.updateProjectionMatrix();
  }

  updateCamera(notify = true) {
    const cameraRotation = this.viewQuaternion().invert();
    this.camera.quaternion.copy(cameraRotation);
    const amount = this.worldUnitsPerPixel();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraRotation);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraRotation);
    this.target.copy(this.center)
      .addScaledVector(right, -this.panX * amount)
      .addScaledVector(up, this.panY * amount);
    this.camera.position
      .set(0, 0, this.distance)
      .applyQuaternion(cameraRotation)
      .add(this.target);
    this.updateClipping();
    this.camera.updateMatrixWorld(true);
    if (notify) this.onChange();
  }

  worldUnitsPerPixel() {
    return (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / this.height;
  }

  panByPixels(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.updateCamera();
  }

  handlePointerDown(event) {
    if (!this.enabled || this.pointer || ![0, 1, 2].includes(event.button)) return;
    event.preventDefault();
    this.domElement.focus({ preventScroll: true });
    this.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      pan: event.shiftKey || event.button !== 0,
    };
    this.domElement.setPointerCapture(event.pointerId);
    this.domElement.style.cursor = "grabbing";
  }

  handlePointerMove(event) {
    const pointer = this.pointer;
    if (!this.enabled || !pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > CLICK_TOLERANCE) {
      pointer.moved = true;
    }
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (!pointer.moved) return;
    if (pointer.pan || event.shiftKey) this.panByPixels(dx, dy);
    else {
      this.yaw += dx * ROTATION_PER_PIXEL;
      this.pitch += dy * ROTATION_PER_PIXEL;
      this.updateCamera();
    }
  }

  handlePointerUp(event) {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    const isClick = !pointer.moved
      && !pointer.pan
      && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) <= CLICK_TOLERANCE;
    this.pointer = null;
    this.domElement.style.cursor = "grab";
    if (this.domElement.hasPointerCapture(event.pointerId)) this.domElement.releasePointerCapture(event.pointerId);
    if (isClick) this.onClick(event);
  }

  handlePointerCancel(event) {
    if (!this.pointer || (event.pointerId !== undefined && this.pointer.id !== event.pointerId)) return;
    this.pointer = null;
    this.domElement.style.cursor = "grab";
  }

  handleWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
    const requestedRatio = Math.exp(-delta * ZOOM_PER_WHEEL_PIXEL);
    const previousDistance = this.distance;
    this.distance = THREE.MathUtils.clamp(previousDistance / requestedRatio, this.minDistance, this.maxDistance);
    const appliedRatio = previousDistance / this.distance;
    const rect = this.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    this.panX = x - (x - this.panX) * appliedRatio;
    this.panY = y - (y - this.panY) * appliedRatio;
    this.updateCamera();
  }

  handleContextMenu(event) {
    event.preventDefault();
  }

  handleKeyDown(event) {
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.fit();
    } else if (event.key === "Escape") this.onEscape(event);
  }

  dispose() {
    if (this.pointer && this.domElement.hasPointerCapture(this.pointer.id)) {
      this.domElement.releasePointerCapture(this.pointer.id);
    }
    this.pointer = null;
    this.domElement.style.cursor = "";
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.domElement.removeEventListener("pointercancel", this.handlePointerCancel);
    this.domElement.removeEventListener("lostpointercapture", this.handlePointerCancel);
    this.domElement.removeEventListener("wheel", this.handleWheel);
    this.domElement.removeEventListener("contextmenu", this.handleContextMenu);
    this.domElement.removeEventListener("keydown", this.handleKeyDown);
  }
}

