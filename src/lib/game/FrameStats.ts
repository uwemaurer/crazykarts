// Rolling-window frame statistics, per the recommendation in
// https://vplesko.com/posts/how_to_implement_an_fps_counter.html
//
// Why this and not `1/deltaTime` or an EMA?
//
// - `1/deltaTime` is single-frame instantaneous: a single hitch flashes for
//   one frame and is gone before you can read it. FPS is by definition an
//   aggregate, so it must aggregate over multiple frames.
//
// - Averaging over a fixed *frame count* (e.g. last 5 frames) makes the
//   measurement window's *time duration* depend on the values being
//   measured. Slow frames stretch the window, fast frames shrink it; the
//   resulting graph is self-referentially distorted.
//
// - The right answer is a fixed *time window* (typically 1 second). Each
//   sample carries a timestamp; we drop samples older than `window`. FPS =
//   `count / window`, mean = sum/count, max = direct over the window.
//
// The class also stores the per-frame `value` (e.g. ms), which lets us read
// out average frametime and worst frame in the same pass — the latter is
// what reveals stutters that average alone hides.

export class FrameStats {
  private readonly windowSeconds: number;
  private readonly capacity: number;
  // Two parallel arrays for cache-friendly iteration. Float64 for timestamp
  // (performance.now() in ms can exceed 2^24 quickly), Float32 for value.
  private readonly timestamps: Float64Array;
  private readonly values: Float32Array;
  // Ring-buffer indices. `head` points at the oldest sample, `tail` at the
  // next slot to write. `size` ∈ [0, capacity].
  private head = 0;
  private tail = 0;
  private size = 0;

  constructor(windowSeconds = 1, expectedMaxFps = 240) {
    this.windowSeconds = windowSeconds;
    // 1.5× headroom so a brief surge above expected fps doesn't drop samples.
    // At 240 fps × 1 s × 1.5 = 360 slots; ≈ 4 KB, negligible.
    this.capacity = Math.max(8, Math.ceil(expectedMaxFps * windowSeconds * 1.5));
    this.timestamps = new Float64Array(this.capacity);
    this.values = new Float32Array(this.capacity);
  }

  /** timestamp in seconds (use `performance.now() / 1000`). */
  push(timestamp: number, value: number): void {
    // Evict expired samples from the head end.
    const cutoff = timestamp - this.windowSeconds;
    while (this.size > 0 && this.timestamps[this.head] < cutoff) {
      this.head = (this.head + 1) % this.capacity;
      this.size--;
    }
    // If the ring is full despite the headroom (sustained burst far above
    // expected fps), drop the oldest to make room.
    if (this.size >= this.capacity) {
      this.head = (this.head + 1) % this.capacity;
      this.size--;
    }
    this.timestamps[this.tail] = timestamp;
    this.values[this.tail] = value;
    this.tail = (this.tail + 1) % this.capacity;
    this.size++;
  }

  /** Number of samples currently in the window. */
  count(): number {
    return this.size;
  }

  /** Frames-per-second estimate for the configured time window. */
  fps(): number {
    return this.size / this.windowSeconds;
  }

  /** Average sample value in the window (e.g. average frametime in ms). */
  mean(): number {
    if (this.size === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.size; i++) {
      sum += this.values[(this.head + i) % this.capacity];
    }
    return sum / this.size;
  }

  /** Worst-frame sample in the window — the "1% low" essence. */
  max(): number {
    if (this.size === 0) return 0;
    let m = -Infinity;
    for (let i = 0; i < this.size; i++) {
      const v = this.values[(this.head + i) % this.capacity];
      if (v > m) m = v;
    }
    return m;
  }
}
