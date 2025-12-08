---
name: Frontend-TSX-Material-Design
description: Enforce Material Design when generating React TSX UI in the frontend.
applyTo: "frontend/src/**/*.tsx"
---

- Build UI to match Google's latest Material Design guidance: layout grid, elevation, motion, color, typography, and accessibility.
- Prefer tailwindcss which mimics Material design principles.
- Use semantic ARIA labels and keyboard-friendly interactions; maintain WCAG AA contrast.
- Keep spacing, sizing, and corner radii consistent with Material tokens (e.g., 4dp multiples) and use responsive breakpoints.
- Provide meaningful motion/transitions only where they reinforce hierarchy or affordances; avoid gratuitous animation.
- We dont have Material UI, just tailwind.
