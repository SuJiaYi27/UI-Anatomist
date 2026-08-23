export const INTERACTION_RESTORE_ABORT_CODE = 'interaction-restore-abort' as const

export const INTERACTION_RESTORE_ABORT_MESSAGE =
  'Refresh this page before running UI-Anatomist again.'

export const INTERACTION_RESTORE_REASONS = [
  'url-changed',
  'new-visible-structure',
  'owned-structure-visible',
  'baseline-structure-missing',
  'baseline-structure-changed',
  'reversible-state-changed',
  'details-state-changed',
  'tab-state-changed',
  'interaction-state-changed',
  'native-file-guard',
  'recovery-unsafe-change',
  'unknown'
] as const

export type InteractionRestoreReason = typeof INTERACTION_RESTORE_REASONS[number]

export function isInteractionRestoreReason(
  value: unknown
): value is InteractionRestoreReason {
  return typeof value === 'string' &&
    (INTERACTION_RESTORE_REASONS as readonly string[]).includes(value)
}

export class InteractionRestoreError extends Error {
  readonly code = INTERACTION_RESTORE_ABORT_CODE
  readonly reason: InteractionRestoreReason

  constructor(
    reason: InteractionRestoreReason = 'unknown',
    message = INTERACTION_RESTORE_ABORT_MESSAGE
  ) {
    super(message)
    this.name = 'InteractionRestoreError'
    this.reason = reason
  }
}

export function isInteractionRestoreError(
  error: unknown
): error is {
  code: typeof INTERACTION_RESTORE_ABORT_CODE
  reason?: InteractionRestoreReason
} {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === INTERACTION_RESTORE_ABORT_CODE
}
