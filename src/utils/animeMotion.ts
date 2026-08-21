import { animate } from 'animejs'

type AnimeTargets = Parameters<typeof animate>[0]
type AnimeParams = Parameters<typeof animate>[1]

/**
 * Central gate for UI motion. Anime.js is still the animation engine, but the
 * browser's reduced-motion preference always wins over visual polish.
 */
export function animateIfAllowed(targets: AnimeTargets, params: AnimeParams) {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  return animate(targets, params)
}

