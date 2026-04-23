// @ts-expect-error — jsfxr has no bundled types
import { sfxr } from 'jsfxr';

type PresetName = 'laserShoot' | 'explosion' | 'hitHurt' | 'jump' | 'pickupCoin';

export type SfxName = 'mine' | 'place' | 'pickup' | 'jump' | 'land';

type Synthdef = Record<string, number | boolean>;

// Block break: short noise burst, mid-low frequency, slight downward sweep.
const MINE_SYNTHDEF: Synthdef = {
  oldParams: true,
  wave_type: 3, // noise
  p_env_attack: 0.0,
  p_env_sustain: 0.05,
  p_env_punch: 0.25,
  p_env_decay: 0.14,
  p_base_freq: 0.22,
  p_freq_limit: 0.0,
  p_freq_ramp: -0.12,
  p_freq_dramp: 0.0,
  p_vib_strength: 0.0,
  p_vib_speed: 0.0,
  p_arp_mod: 0.0,
  p_arp_speed: 0.0,
  p_duty: 0.0,
  p_duty_ramp: 0.0,
  p_repeat_speed: 0.0,
  p_pha_offset: 0.0,
  p_pha_ramp: 0.0,
  p_lpf_freq: 0.42,
  p_lpf_ramp: 0.0,
  p_lpf_resonance: 0.2,
  p_hpf_freq: 0.05,
  p_hpf_ramp: 0.0,
  sound_vol: 0.3,
  sample_rate: 44100,
  sample_size: 8,
};

// Block place: short percussive thunk.
const PLACE_SYNTHDEF: Synthdef = {
  oldParams: true,
  wave_type: 3, // noise
  p_env_attack: 0.0,
  p_env_sustain: 0.03,
  p_env_punch: 0.35,
  p_env_decay: 0.09,
  p_base_freq: 0.32,
  p_freq_limit: 0.0,
  p_freq_ramp: -0.18,
  p_freq_dramp: 0.0,
  p_vib_strength: 0.0,
  p_vib_speed: 0.0,
  p_arp_mod: 0.0,
  p_arp_speed: 0.0,
  p_duty: 0.0,
  p_duty_ramp: 0.0,
  p_repeat_speed: 0.0,
  p_pha_offset: 0.0,
  p_pha_ramp: 0.0,
  p_lpf_freq: 0.55,
  p_lpf_ramp: 0.0,
  p_lpf_resonance: 0.15,
  p_hpf_freq: 0.08,
  p_hpf_ramp: 0.0,
  sound_vol: 0.28,
  sample_rate: 44100,
  sample_size: 8,
};

// Landing thud: low noise with strong punch, quick decay.
const LAND_SYNTHDEF: Synthdef = {
  oldParams: true,
  wave_type: 3, // noise
  p_env_attack: 0.0,
  p_env_sustain: 0.06,
  p_env_punch: 0.55,
  p_env_decay: 0.18,
  p_base_freq: 0.12,
  p_freq_limit: 0.0,
  p_freq_ramp: -0.08,
  p_freq_dramp: 0.0,
  p_vib_strength: 0.0,
  p_vib_speed: 0.0,
  p_arp_mod: 0.0,
  p_arp_speed: 0.0,
  p_duty: 0.0,
  p_duty_ramp: 0.0,
  p_repeat_speed: 0.0,
  p_pha_offset: 0.0,
  p_pha_ramp: 0.0,
  p_lpf_freq: 0.28,
  p_lpf_ramp: 0.0,
  p_lpf_resonance: 0.1,
  p_hpf_freq: 0.0,
  p_hpf_ramp: 0.0,
  sound_vol: 0.4,
  sample_rate: 44100,
  sample_size: 8,
};

const SOURCES: Record<SfxName, { preset?: PresetName; synthdef?: Synthdef }> = {
  mine: { synthdef: MINE_SYNTHDEF },
  place: { synthdef: PLACE_SYNTHDEF },
  pickup: { preset: 'pickupCoin' },
  jump: { preset: 'jump' },
  land: { synthdef: LAND_SYNTHDEF },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers: Partial<Record<SfxName, AudioBuffer>> = {};
  private unlocked = false;

  constructor(private volume = 0.4) {}

  attachUnlock(target: Window | HTMLElement = window) {
    const unlock = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    };
    const opts: AddEventListenerOptions = { once: false, passive: true };
    target.addEventListener('keydown', unlock, opts);
    target.addEventListener('pointerdown', unlock, opts);
    target.addEventListener('touchstart', unlock, opts);
  }

  private ensureContext() {
    if (this.ctx) return;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.unlocked = true;
    for (const name of Object.keys(SOURCES) as SfxName[]) {
      const src = SOURCES[name];
      const synthdef = src.synthdef ?? sfxr.generate(src.preset!);
      this.buffers[name] = this.renderBuffer(synthdef);
    }
  }

  private renderBuffer(synthdef: Synthdef): AudioBuffer | undefined {
    if (!this.ctx) return undefined;
    const source: AudioBufferSourceNode = sfxr.toWebAudio(synthdef, this.ctx);
    return source.buffer ?? undefined;
  }

  play(name: SfxName, detune = 0) {
    if (!this.unlocked) this.ensureContext();
    if (!this.ctx || !this.master) return;
    const buffer = this.buffers[name];
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.detune.value = detune + (Math.random() * 120 - 60);
    src.connect(this.master);
    src.start();
  }
}
