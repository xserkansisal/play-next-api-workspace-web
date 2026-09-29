import axios, { isAxiosError } from 'axios'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 10_000,
  headers: { Accept: 'application/json' },
})

export type HealthResponse = unknown

export async function checkHealth(): Promise<HealthResponse> {
  const response = await apiClient.get<HealthResponse>('/health')
  return response.data
}

export function describeApiError(error: unknown): string {
  if (isAxiosError(error)) {
    if (error.response) {
      return `API responded with ${error.response.status}${error.response.statusText ? ` ${error.response.statusText}` : ''}`
    }
    return error.message || 'Network error: unable to reach the API'
  }
  return error instanceof Error ? error.message : 'Unknown error'
}
