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
