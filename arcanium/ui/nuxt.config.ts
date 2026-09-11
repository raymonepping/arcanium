import tailwindcss from '@tailwindcss/vite'
export default defineNuxtConfig({
  compatibilityDate: '2026-09-10',
  future: { compatibilityVersion: 4 },

  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  experimental: { viewTransition: true },

  runtimeConfig: {
    // Server-only: internal URL used by the server-side gateway proxy
    // Overridden at runtime by NUXT_ARCANIUM_API_INTERNAL env var
    arcaniumApiInternal: 'http://localhost:3001',
    public: {
      // Browser-visible: same-origin /gateway path
      apiBase: '/gateway',
      // Vault UI is a separate product — opened in a new tab, never proxied.
      // Override with NUXT_PUBLIC_VAULT_UI_URL.
      vaultUiUrl: 'http://localhost:18200',
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  nitro: {
    // Inline the API base URL into the server bundle
  },

  // Prompt 18 Deliverable 6 — security headers on every UI response. The
  // browser only ever talks to this same origin (apiBase: '/gateway' above)
  // — connect-src 'self' makes that enforced client-side, not just true by
  // convention. style-src keeps 'unsafe-inline' for Vue's scoped-style
  // injection.
  //
  // script-src 'unsafe-inline' correction (found live, the hard way): the
  // original comment here claimed Nuxt SSR ships hydration state as
  // non-executable JSON only — true for the __NUXT_DATA__ script tag, but
  // WRONG in general. Nuxt/Vite also emit an inline `<script
  // type="importmap">` and a small inline bootstrap `<script>` with no
  // `src` and no nonce. Under strict `script-src 'self'` with no
  // 'unsafe-inline', a real browser blocks both — the app never hydrates
  // client-side at all (no client routing, no onMounted data fetches, no
  // interactivity), which is exactly the "login page won't show / all API
  // data gone" symptom this caused. The correct long-term fix is a
  // per-request nonce (Nuxt/Nitro doesn't wire one up out of the box
  // without an extra module); 'unsafe-inline' is the honest interim
  // trade-off — still same-origin only, no external script host is ever
  // allowed, object-src/frame-ancestors stay locked down.
  routeRules: {
    "/**": {
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; connect-src 'self'; img-src 'self' data:; " +
          "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
          "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        // Found live: without this, a browser can restore a page via
        // back-forward cache (bfcache) — an old render shown from memory
        // with no fresh request to the server at all — regardless of
        // whether the auth middleware would now redirect it. `no-store` is
        // the one directive that reliably disables bfcache for this
        // navigation in every major browser. Every page here is either
        // dynamic (session-dependent) or a management screen; nothing on
        // this app benefits from being cacheable.
        "Cache-Control": "no-store",
      },
    },
    // Static build output IS safe to cache hard — filenames are
    // content-hashed by Nuxt, so a new build is a new URL, never a stale hit.
    "/_nuxt/**": {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  },

  app: {
    head: {
      title: 'Arcanium',
      meta: [
        { name: 'description', content: 'Arcanium — Enterprise Cryptographic Lifecycle Platform' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
    // Restrained View Transitions for entity navigation

  },
})
