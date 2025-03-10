<script lang="ts">
  import { onMount } from 'svelte';
  import { Game } from './lib/game/Game';

  let container: HTMLDivElement;
  let game: Game;

  onMount(() => {
    game = new Game(container);
    game.animate();

    const handleResize = () => {
      game.handleResize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      // Game class will clean up its own event listeners
    };
  });
</script>

<main>
  <div 
    bind:this={container} 
    class="game-container"
  />
  <div class="controls">
    <p>Use Arrow Keys or WASD to control the car</p>
    <p>Press SPACE to shoot rockets</p>
  </div>
</main>

<style>
  .game-container {
    width: 100vw;
    height: 100vh;
  }

  .controls {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
  }
</style>