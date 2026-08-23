import type { ScanExport } from '../shared/schema'
import { parseScanExport } from './import-plan'

type UndoPort = {
  commitUndo(): void
  triggerUndo(): void
}

export type ImportTransaction = {
  data: ScanExport
  commit(): void
  rollback(): void
}

export function beginImportTransaction(value: string, undo: UndoPort): ImportTransaction {
  const data = parseScanExport(value)
  undo.commitUndo()
  let active = true

  return {
    data,
    commit() {
      if (!active) return
      undo.commitUndo()
      active = false
    },
    rollback() {
      if (!active) return
      undo.triggerUndo()
      active = false
    }
  }
}
