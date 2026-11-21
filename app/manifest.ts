// app/manifest.ts
// Web app manifest: lets Chrome (Android and desktop) install Blockparty as
// an app with its own window and home-screen icon. Chrome only offers
// "Install" for display: standalone (or fullscreen / minimal-ui).
// Icons: the C3 monogram, from public/icon-192.png and public/icon-512.png.
// On Vercel preview deployments Next.js fetches this with credentials, so it
// works behind Vercel's login wall; the live site's password wall lets it through
// (proxy.ts).
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Blockparty — Your Neighborhood Marketplace',
    short_name: 'Blockparty',
    description: 'Bid, buy and sell safely with neighbors.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF8F5',
    theme_color: '#FAF8F5',
    categories: ['shopping', 'lifestyle'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
