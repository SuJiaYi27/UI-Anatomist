const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const numericId = /^\d{3,}$/

export function sanitizeRoute(raw: string): string {
  const url = new URL(raw)
  const segments = url.pathname
    .split('/')
    .map(segment => uuid.test(segment) || numericId.test(segment) ? ':id' : segment)
  return `${url.origin}${segments.join('/')}`
}

export function siteLabelFromOrigin(raw: string): string {
  return new URL(raw).hostname
}

