const MAX_KEY_LENGTH = 200
/** `_copy`, `_copy2`, ... A key cannot contain whitespace or braces, so the marker cannot either. */
const COPY_SUFFIX = /^(.*?)_copy\d*$/i

/** The key with a trailing copy marker removed, so duplicating a duplicate does not nest them. */
export function variableKeyStem(key: string): string {
  const stripped = COPY_SUFFIX.exec(key)?.[1]
  return stripped ? stripped : key
}

/**
 * The first free key of the form `key_copy`, `key_copy2`, ... for a duplicate of `key`.
 *
 * Environment variable keys are unique within their environment, so a duplicate that kept the
 * original key would be rejected on save - and the save rewrites the whole list, so the user
 * would lose the rest of their edits with it. A blank key is left blank: the row is incomplete
 * either way, and `_copy` would be a worse starting point than nothing.
 */
export function copyVariableKey(key: string, isTaken: (candidate: string) => boolean): string {
  if (!key.trim()) return key
  const stem = variableKeyStem(key)
  for (let n = 1; ; n += 1) {
    const marker = n === 1 ? '_copy' : `_copy${n}`
    const candidate = stem.slice(0, MAX_KEY_LENGTH - marker.length) + marker
    if (!isTaken(candidate)) return candidate
  }
}
