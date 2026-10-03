/**
 * A loose, defensive subset of the Postman Collection v2.1 schema
 * (https://schema.getpostman.com/json/collection/v2.1.0/collection.json).
 *
 * Real-world exports vary (older exporters, hand-edited files, other tools that
 * "speak" the format loosely), so every field here is optional/untyped at the
 * boundary and validated defensively in postman-import.ts rather than trusted.
 */

export type PostmanDescription = string | { content?: string; type?: string } | null | undefined

export interface PostmanVariable {
  key?: string
  value?: unknown
  type?: string
  disabled?: boolean
  description?: PostmanDescription
}

export interface PostmanUrl {
  raw?: string
  protocol?: string
  host?: string[] | string
  path?: string[] | string
  port?: string
  query?: PostmanVariable[]
  variable?: PostmanVariable[]
}

export interface PostmanHeader {
  key?: string
  value?: string
  disabled?: boolean
  description?: PostmanDescription
}

export interface PostmanAuth {
  type?: string
  [key: string]: unknown
}

export interface PostmanBody {
  mode?: string
  raw?: string
  urlencoded?: unknown[]
  formdata?: unknown[]
  graphql?: unknown
  file?: unknown
  options?: { raw?: { language?: string } }
}

export interface PostmanRequest {
  method?: string
  header?: PostmanHeader[]
  headers?: PostmanHeader[] // some real-world exporters use the plural key
  url?: string | PostmanUrl
  body?: PostmanBody | null
  auth?: PostmanAuth
  description?: PostmanDescription
}

export interface PostmanItem {
  name?: string
  description?: PostmanDescription
  item?: PostmanItem[] // present on folders ("item groups")
  request?: PostmanRequest | string // present on request leaves
  event?: unknown[]
  protocolProfileBehavior?: unknown
}

export interface PostmanCollection {
  info?: {
    name?: string
    description?: PostmanDescription
    schema?: string
  }
  item?: PostmanItem[]
  event?: unknown[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth
  protocolProfileBehavior?: unknown
}
