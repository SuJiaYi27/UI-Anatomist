export function isSafeControlSampleTextValue(value: string): boolean {
  const normalized = value.trim()
  if (!normalized || /[\r\n\t]/.test(value)) return false
  if ([...normalized].length > 32) return false
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(normalized)) return false
  if (/(?:https?:\/\/|www\.)\S+/i.test(normalized)) return false
  if (/\b(?:[a-z0-9-]+\.)+(?:ai|app|biz|cn|co|com|dev|info|io|me|net|org)(?:\/\S*)?\b/i.test(normalized)) {
    return false
  }
  if (/\b[a-z][a-z0-9]*[_-][a-z0-9]{8,}\b/i.test(normalized)) return false
  if (
    normalized.length >= 10 &&
    /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(normalized)
  ) return false
  if (
    /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/.test(normalized)
  ) return false
  if (
    /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(normalized) &&
    /[A-Z]/.test(normalized.slice(normalized.indexOf('/') + 1))
  ) return false
  if (/^v?\d+(?:\.\d+){1,3}(?:[-+][a-z0-9.-]+)?$/i.test(normalized)) {
    return false
  }
  if (/\d{7,}/.test(normalized)) return false
  if (/(?:\+?\d[\d ()-]{8,}\d)/.test(normalized)) return false
  const punctuationCount = (normalized.match(/[.,;:!?，。；：！？、]/g) ?? []).length
  if (punctuationCount >= 4) return false
  return true
}

export function isSafeIconNameValue(value: string): boolean {
  const normalized = value.normalize('NFKC').trim()
  if (/^icon-[0-9a-f]{6}$/i.test(normalized)) return true
  if (/[\\/]/.test(normalized)) return false
  return isSafeControlSampleTextValue(normalized) && !/\p{N}/u.test(normalized)
}
