const SECRET_KEY_PATTERN = 'api[_-]?key|token|secret|password|authorization|cookie|credential|private[_-]?key'
const SECRET_KEY = new RegExp(`(?:${SECRET_KEY_PATTERN})`, 'i')
const SECRET_VALUE = /(?:sk-[A-Za-z0-9_-]{12,}|(?:ghp|github_pat)_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]+?-----END[^\n]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g
const URL_CREDENTIALS = /(:\/\/[^\s:@/]+:)([^\s@/]+)(@)/g
const KEY_VALUE_ASSIGNMENT = new RegExp(`([A-Za-z_][\\w.-]*)(\\s*[:=]\\s*)(['"]?)([^\\s'"]{8,})\\3`, 'g')

function redactString(value: string): string {
  return value
    .replace(SECRET_VALUE, '[REDACTED]')
    .replace(URL_CREDENTIALS, (_match, prefix, _password, at) => `${prefix}[REDACTED]${at}`)
    .replace(KEY_VALUE_ASSIGNMENT, (match, key, sep, quote) => (SECRET_KEY.test(key) ? `${key}${sep}${quote}[REDACTED]${quote}` : match))
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redact(item),
    ]))
  }
  return value
}

export function redactText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redact(value) as string
}
