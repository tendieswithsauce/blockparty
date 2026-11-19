// app/manifest.ts
// Web app manifest: the name and icon Android shows when someone adds
// Blockparty to their home screen. Opens in the normal browser (no
// app-style standalone mode). Icons: the C3 monogram, from
// public/icon-192.png and public/icon-512.png.
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Blockparty — Your Neighborhood Marketplace',
    short_name: 'Blockparty',
    description: 'Bid, buy and sell safely with neighbors.',
    start_url: '/',
    display: 'browser',
    background_color: '#FAF8F5',
    theme_color: '#FAF8F5',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
