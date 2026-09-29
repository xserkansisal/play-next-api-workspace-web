import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { checkHealth, describeApiError } from '@/lib/api'

type HealthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: unknown }
  | { status: 'error'; message: string }

export function HealthCheck() {
  const [state, setState] = useState<HealthState>({ status: 'idle' })

  async function runCheck() {
    setState({ status: 'loading' })
    try {
      const data = await checkHealth()
      setState({ status: 'success', data })
    } catch (error) {
      setState({ status: 'error', message: describeApiError(error) })
    }
  }

  const isLoading = state.status === 'loading'

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">API health</h2>
        <Button onClick={runCheck} disabled={isLoading}>
          {isLoading ? 'Checking…' : 'Check API health'}
        </Button>
      </div>
      {state.status === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          Contacting API…
        </p>
      )}
      {state.status === 'success' && (
        <div role="status" className="text-sm">
          <p className="font-medium text-green-700">API is healthy</p>
          <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(state.data, null, 2)}
          </pre>
        </div>
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          Health check failed: {state.message}
        </p>
      )}
    </section>
  )
}
