export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

export type SelectionKeyboardAction =
  | { type: 'move'; dx: number; dz: number }
  | { type: 'rotate'; direction: -1 | 1 }
  | { type: 'delete' }

export function normalizeScreenRect(startX: number, startY: number, endX: number, endY: number): ScreenRect {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY),
  }
}

export function screenRectsIntersect(left: ScreenRect, right: ScreenRect) {
  return left.left <= right.right
    && left.right >= right.left
    && left.top <= right.bottom
    && left.bottom >= right.top
}

export function selectionKeyboardAction(key: string): SelectionKeyboardAction | null {
  const normalizedKey = key.toLowerCase().replace(/^key/, '')
  switch (normalizedKey) {
    case 'w': return { type: 'move', dx: 0, dz: -1 }
    case 'a': return { type: 'move', dx: -1, dz: 0 }
    case 's': return { type: 'move', dx: 0, dz: 1 }
    case 'd': return { type: 'move', dx: 1, dz: 0 }
    case 'q': return { type: 'rotate', direction: -1 }
    case 'e': return { type: 'rotate', direction: 1 }
    case 'del':
    case 'delete': return { type: 'delete' }
    case 'numpaddecimal': return { type: 'delete' }
    case 'backspace': return { type: 'delete' }
    default: return null
  }
}
