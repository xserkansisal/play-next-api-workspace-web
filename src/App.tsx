import { HealthCheck } from '@/components/HealthCheck'

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Play Next API Workspace</h1>
      <HealthCheck />
    </main>
  )
}
