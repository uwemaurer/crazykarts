<script lang="ts">
  import { onMount } from 'svelte';
  import { Game } from './lib/game/Game';

  let container: HTMLDivElement;
  let joystickBase: HTMLDivElement;
  let game: Game;
  let errorMessage = '';
  let isTouch = false;

  let knobX = 0;
  let knobY = 0;
  let activePointer: number | null = null;
  const JOYSTICK_RADIUS = 55;

  onMount(() => {
    isTouch = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;

    try {
      game = new Game(container);
      game.animate();
    } catch (err) {
      console.error('Failed to start game:', err);
      const detail = err instanceof Error ? err.message : String(err);
      errorMessage = `Could not start the game: ${detail}. This game needs WebGL — please try a different browser, enable hardware acceleration, or reload the page.`;
      return;
    }

    const handleResize = () => {
      game.handleResize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });

  function updateJoystick(e: PointerEvent) {
    const rect = joystickBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }
    knobX = dx;
    knobY = dy;
    game.setTouchInput(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS);
  }

  function onJoystickDown(e: PointerEvent) {
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId);
    updateJoystick(e);
  }

  function onJoystickMove(e: PointerEvent) {
    if (e.pointerId !== activePointer) return;
    updateJoystick(e);
  }

  function onJoystickUp(e: PointerEvent) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    knobX = 0;
    knobY = 0;
    game.setTouchInput(0, 0);
  }

  function onMine() {
    game.primaryAction();
  }
</script>

<main>
  <div
    bind:this={container}
    class="game-container"
    class:touch={isTouch}
  ></div>

  {#if errorMessage}
    <div class="error" role="alert">
      <h2>Something went wrong</h2>
      <p>{errorMessage}</p>
      <button on:click={() => window.location.reload()}>Reload</button>
    </div>
  {:else if isTouch}
    <div
      bind:this={joystickBase}
      class="joystick-base"
      on:pointerdown={onJoystickDown}
      on:pointermove={onJoystickMove}
      on:pointerup={onJoystickUp}
      on:pointercancel={onJoystickUp}
    >
      <div
        class="joystick-knob"
        style="transform: translate({knobX}px, {knobY}px);"
      ></div>
    </div>
    <button
      class="fire-button"
      on:pointerdown={onMine}
    >MINE</button>
  {:else}
    <div class="controls">
      <p>WASD to walk · Mouse to look (click to capture) · Space to jump</p>
      <p>Left click: mine · Right click: place · 1–9 or wheel: hotbar · E: help build</p>
    </div>
  {/if}
</main>

<style>
  .game-container {
    width: 100vw;
    height: 100vh;
  }

  .game-container.touch {
    touch-action: none;
  }

  .controls {
    position: fixed;
    bottom: 90px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 8px 16px;
    border-radius: 5px;
    font-size: 12px;
    line-height: 1.4;
    text-align: center;
    pointer-events: none;
    z-index: 4;
  }

  .controls p {
    margin: 2px 0;
  }

  .joystick-base {
    position: fixed;
    bottom: 30px;
    left: 30px;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    border: 2px solid rgba(255, 255, 255, 0.35);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    z-index: 10;
  }

  .joystick-knob {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 60px;
    height: 60px;
    margin-top: -30px;
    margin-left: -30px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.7);
    border: 2px solid rgba(255, 255, 255, 0.9);
    pointer-events: none;
  }

  .fire-button {
    position: fixed;
    bottom: 50px;
    right: 30px;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: rgba(255, 80, 80, 0.85);
    border: 3px solid rgba(255, 255, 255, 0.9);
    color: white;
    font-size: 20px;
    font-weight: bold;
    font-family: Arial, sans-serif;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .fire-button:active {
    background: rgba(255, 40, 40, 0.95);
    transform: scale(0.95);
  }

  .error {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(20, 20, 20, 0.95);
    color: white;
    padding: 24px 32px;
    border-radius: 8px;
    max-width: 480px;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .error h2 {
    margin: 0 0 12px 0;
    color: #ff6b6b;
  }

  .error p {
    margin: 0 0 16px 0;
    line-height: 1.5;
  }

  .error button {
    padding: 8px 20px;
    background: #ff6b6b;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .error button:hover {
    background: #ff5252;
  }
</style>
