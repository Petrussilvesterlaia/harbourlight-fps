// Keyboard and mouse capture with pointer lock. Held keys live in a Set, one-shot
// presses in a queue the main loop drains each frame, and mouse movement is
// accumulated into deltas the player controller consumes — no listeners anywhere else.
export class Input {
  constructor(element, onLockChange) {
    this.element = element;
    this.keys = new Set();
    this.pressed = [];
    this.lookX = 0;
    this.lookY = 0;
    this.firing = false;
    this.aiming = false;
    this.locked = false;
    this.onLockChange = onLockChange;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX || 0;
      this.lookY += e.movementY || 0;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) {
        this.firing = false;
        this.aiming = false;
        this.keys.clear();
      }
      this.onLockChange(this.locked);
    });
  }

  requestLock() {
    this.element.requestPointerLock();
  }

  takeLook() {
    const out = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  drainPressed() {
    const out = this.pressed;
    this.pressed = [];
    return out;
  }

  get channelHeld() {
    return this.keys.has('KeyE');
  }
  get crouchHeld() {
    return this.keys.has('ControlLeft') || this.keys.has('KeyC');
  }
  get walkHeld() {
    return this.keys.has('ShiftLeft');
  }
  get scoreboardHeld() {
    return this.keys.has('Tab');
  }
}
