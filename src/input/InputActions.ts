import type { InputConfig } from '@/config/Config';
import { clamp } from '@/core/math';
import type { RawInput } from './RawInput';

/** Logical actions the game reads; their keys come from config/input.json. */
export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'jump'
  | 'handbrake'
  | 'use'
  | 'help'
  | 'mute'
  | 'respawn';

/**
 * Game-facing input: named actions and axes, independent of the device.
 * Keyboard bindings are data; the touch joystick and buttons feed the same
 * raw state, so gameplay code never sees a key code.
 */
export class InputActions {
  private readonly bindings: Record<Action, string[]>;

  constructor(
    readonly raw: RawInput,
    config: InputConfig,
  ) {
    this.bindings = config.bindings as Record<Action, string[]>;
  }

  held(a: Action): boolean {
    return this.raw.isDown(...(this.bindings[a] ?? []));
  }

  pressed(a: Action): boolean {
    return this.raw.wasPressed(...(this.bindings[a] ?? []));
  }

  /** Forward/back, -1..1 (keyboard + virtual stick). */
  get moveY(): number {
    return clamp(Number(this.held('moveForward')) - Number(this.held('moveBack')) + this.raw.stickY, -1, 1);
  }

  /** Right/left, -1..1. */
  get moveX(): number {
    return clamp(Number(this.held('moveRight')) - Number(this.held('moveLeft')) + this.raw.stickX, -1, 1);
  }

  /** Sprint key, or the virtual stick pushed to its rim. */
  get sprinting(): boolean {
    return this.held('sprint') || Math.hypot(this.raw.stickX, this.raw.stickY) > 0.92;
  }
}
