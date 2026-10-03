import { useState } from 'react'

import {
  describeOpenApiWarning,
  OPENAPI_FILE_ACCEPT,
  readOpenApiFile,
  type OpenApiImportWarning,
  type OpenApiSpecFile,
} from '@/lib/openapi'

interface OpenApiFilePickerProps {
  file: OpenApiSpecFile | null
  disabled?: boolean
  onFile: (file: OpenApiSpecFile) => void
  onError: (message: string) => void
}

/** Reads the chosen .json/.yaml/.yml file as text. The selection stays visible and replaceable. */
export function OpenApiFilePicker({ file, disabled, onFile, onError }: OpenApiFilePickerProps) {
  const [dragging, setDragging] = useState(false)

  async function select(selected: File) {
    try {
      onFile(await readOpenApiFile(selected))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Unable to read this file.')
    }
  }

  return (
    <label
      className={`postman-import-dropzone openapi-dropzone${dragging ? ' dragging' : ''}${file ? ' has-file' : ''}`}
      aria-disabled={disabled || undefined}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const dropped = event.dataTransfer.files[0]
        if (dropped && !disabled) void select(dropped)
      }}
    >
      <input
        type="file"
        accept={OPENAPI_FILE_ACCEPT}
        aria-label="OpenAPI file"
        disabled={disabled}
        onChange={(event) => {
          const selected = event.target.files?.[0]
          if (selected) void select(selected)
          event.currentTarget.value = ''
        }}
      />
      <span className="postman-import-upload-icon" aria-hidden="true">↑</span>
      {file ? (
        <>
          <strong>{file.fileName}</strong>
          <span>File selected · click to choose a different file</span>
        </>
      ) : (
        <>
          <strong>Drop an OpenAPI document here</strong>
          <span>or click to browse · OpenAPI 3.0 / 3.1 as JSON or YAML, up to 10 MB</span>
        </>
      )}
    </label>
  )
}

export function OpenApiWarningList({ warnings, title = 'Review these warnings' }: { warnings: OpenApiImportWarning[]; title?: string }) {
  if (warnings.length === 0) return <p className="bulk-import-no-warnings">No conversion warnings.</p>
  return (
    <div className="bulk-import-warnings openapi-warnings">
      <h3>{title} ({warnings.length})</h3>
      {warnings.map((warning, index) => <p key={`${warning.code}-${index}`}>{describeOpenApiWarning(warning)}</p>)}
    </div>
  )
}
