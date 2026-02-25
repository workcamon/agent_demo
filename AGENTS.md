# AGENTS.md

## Cursor Cloud specific instructions

This is a client-side-only React + TypeScript + Vite PWA (no backend, no database). All data is stored in the browser's `localStorage`.

### Services

| Service | Command | URL |
|---------|---------|-----|
| Vite Dev Server | `npm run dev` | http://localhost:5173 |

### Key commands

See `package.json` scripts and `README.md` for full details. Summary:

- **Dev server**: `npm run dev`
- **Build**: `npm run build` (runs `tsc -b && vite build`)
- **Preview production build**: `npm run preview`

### Notes

- No lint or test scripts are configured in this project. TypeScript type-checking (`tsc -b`) is the primary static analysis tool.
- The app fetches video metadata from YouTube's public oEmbed endpoint (`https://www.youtube.com/oembed`) — no API key required, but internet access is needed.
- The Service Worker (`public/sw.js`) only activates over HTTPS or on `localhost`.
