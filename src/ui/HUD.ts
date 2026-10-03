import type { Vehicle } from '../entities/Vehicle';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id} in index.html`);
  return e as T;
}

const STATE_LABEL: Record<string, string> = {
  idle: 'De pie', walk: 'Andando', run: 'Corriendo', jump: 'Saltando',
  wade: 'Vadeando', swim: 'Nadando', knocked: '¡Atropellado!', driving: 'Conduciendo',
};

/** DOM overlay: zone title, interaction prompt, speedometer, state and help. */
export class HUD {
  private readonly zone = el('zone');
  private readonly prompt = el('prompt');
  private readonly vehiclePanel = el('vehicle-panel');
  private readonly vehName = el('veh-name');
  private readonly speed = el('speed-val');
  private readonly status = el('status');
  private readonly help = el('help');
  private readonly lockHint = el('lock-hint');
  private readonly clock = el('clock');
  private readonly toast = el('toast');
  private toastTimer = 0;
  private currentZone = '';
  private zoneTimer = 0;
  private lastPrompt: string | null = null;

  update(dt: number, zone: string, state: string, vehicle: Vehicle | null, prompt: string | null, locked: boolean): void {
    if (zone !== this.currentZone) {
      this.currentZone = zone;
      this.zone.textContent = zone;
      this.zone.classList.add('show');
      this.zoneTimer = 3.5;
    } else if (this.zoneTimer > 0) {
      this.zoneTimer -= dt;
      if (this.zoneTimer <= 0) this.zone.classList.remove('show');
    }

    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.prompt.innerHTML = prompt ?? '';
      this.prompt.classList.toggle('show', !!prompt);
    }

    this.vehiclePanel.classList.toggle('show', !!vehicle);
    if (vehicle) {
      this.vehName.textContent = vehicle.spec.label;
      this.speed.textContent = String(Math.round(vehicle.speedKmh));
    }
    this.status.textContent = `${STATE_LABEL[state] ?? state} · ${zone}`;
    this.lockHint.classList.toggle('show', !locked);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    const d = new Date();
    this.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  toggleHelp(): void {
    this.help.classList.toggle('show');
  }

  /** Short centred message (mute toggled, cannot exit vehicle...). */
  flash(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = 1.8;
  }
}
