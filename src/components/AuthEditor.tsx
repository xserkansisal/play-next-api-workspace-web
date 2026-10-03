import type { AuthCredentials, RequestAuth, ResourceAuth } from '@/lib/workspace-types'
import type { AuthSource } from '@/lib/auth-resolution'
import { describeAuthSource } from '@/lib/auth-resolution'
import { VariableInput, type VariableLookup } from '@/components/VariableInput'

type AuthType = 'inherit' | 'none' | 'basic' | 'bearer' | 'api-key'

function authType(auth: RequestAuth | ResourceAuth): AuthType {
  return auth === null ? 'inherit' : auth.type
}

function defaultFor(type: AuthType, mode: 'request' | 'resource'): RequestAuth | ResourceAuth {
  switch (type) {
    case 'inherit': return mode === 'resource' ? null : { type: 'inherit' }
    case 'none': return { type: 'none' }
    case 'basic': return { type: 'basic', username: '', password: '' }
    case 'bearer': return { type: 'bearer', token: '' }
    case 'api-key': return { type: 'api-key', in: 'header', key: '', value: '' }
  }
}

function describeAuthValue(auth: AuthCredentials): string {
  switch (auth.type) {
    case 'none': return 'No Auth'
    case 'basic': return 'Basic Auth'
    case 'bearer': return 'Bearer Token'
    case 'api-key': return `API Key (${auth.in === 'header' ? 'header' : 'query param'} "${auth.key || '(unnamed)'}")`
  }
}

export interface AuthEditorProps {
  /**
   * `'request'` offers an "Inherit" option that resolves through the collection/folder tree.
   * `'resource'` (a collection or folder) offers an "Inherit" option too, but there it means
   * "no setting of my own" (`null`), which is a distinct concept from a request's own `inherit`.
   */
  mode: 'request' | 'resource'
  auth: RequestAuth | ResourceAuth
  onChange: (auth: RequestAuth | ResourceAuth) => void
  variables: VariableLookup
  /**
   * What "Inherit" currently resolves to, for a live preview. Omit if there is nothing above this
   * item to inherit from (e.g. a collection with no parent).
   */
  effective?: { auth: AuthCredentials; source: AuthSource }
}

/**
 * Edits a request's, folder's, or collection's own auth setting. Shared across all three via
 * `mode`, since the field shapes (none/basic/bearer/api-key, plus an inherit option) and editing
 * UI are identical - only the meaning of "inherit" and the default differ.
 */
export function AuthEditor({ mode, auth, onChange, variables, effective }: AuthEditorProps) {
  const type = authType(auth)
  const inheritLabel = mode === 'request' ? 'Inherit from parent' : 'Inherit (no auth set here)'

  return (
    <div className="auth-editor">
      <label className="body-type-control">
        <span>Auth type</span>
        <select aria-label="Authentication type" value={type} onChange={(event) => onChange(defaultFor(event.target.value as AuthType, mode))}>
          <option value="inherit">{inheritLabel}</option>
          <option value="none">No Auth</option>
          <option value="basic">Basic Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="api-key">API Key</option>
        </select>
      </label>

      {type === 'inherit' && (
        <p className="tab-note auth-inherit-preview">
          {effective
            ? `Resolves to: ${describeAuthValue(effective.auth)} (from ${describeAuthSource(effective.source)})`
            : 'Resolves to: No Auth (nothing configured above this item)'}
        </p>
      )}

      {type === 'basic' && auth !== null && auth.type === 'basic' && (
        <div className="auth-fields">
          <label className="auth-row"><span>Username</span><VariableInput className="cell-input" variables={variables} aria-label="Basic auth username" value={auth.username} onChange={(event) => onChange({ ...auth, username: event.target.value })} /></label>
          <label className="auth-row"><span>Password</span><VariableInput className="cell-input" variables={variables} aria-label="Basic auth password" value={auth.password} onChange={(event) => onChange({ ...auth, password: event.target.value })} /></label>
        </div>
      )}

      {type === 'bearer' && auth !== null && auth.type === 'bearer' && (
        <div className="auth-fields">
          <label className="auth-row"><span>Token</span><VariableInput className="cell-input" variables={variables} aria-label="Bearer token" value={auth.token} onChange={(event) => onChange({ ...auth, token: event.target.value })} /></label>
        </div>
      )}

      {type === 'api-key' && auth !== null && auth.type === 'api-key' && (
        <div className="auth-fields">
          <label className="auth-row">
            <span>Add to</span>
            <select className="auth-select" aria-label="API key location" value={auth.in} onChange={(event) => onChange({ ...auth, in: event.target.value as 'header' | 'query' })}>
              <option value="header">Header</option>
              <option value="query">Query Param</option>
            </select>
          </label>
          <label className="auth-row"><span>Key</span><VariableInput className="cell-input" variables={variables} aria-label="API key name" value={auth.key} onChange={(event) => onChange({ ...auth, key: event.target.value })} /></label>
          <label className="auth-row"><span>Value</span><VariableInput className="cell-input" variables={variables} aria-label="API key value" value={auth.value} onChange={(event) => onChange({ ...auth, value: event.target.value })} /></label>
        </div>
      )}

      {type === 'none' && <p className="tab-note auth-inherit-preview">No authentication is sent for this {mode === 'request' ? 'request' : 'item, and this stops inheritance for anything below it'}.</p>}
    </div>
  )
}
