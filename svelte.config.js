/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  compilerOptions: {
    // Force Svelte 5 runes mode everywhere: no legacy `let`/`$:` reactivity can slip in.
    runes: true,
  },
};
