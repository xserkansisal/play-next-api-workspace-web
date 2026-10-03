import { Button } from '@/components/ui/button'

export type ImportSource = 'postman' | 'bulk'

interface ImportOptionsDialogProps {
  onCancel: () => void
  onSelect: (source: ImportSource) => void
}

export function ImportOptionsDialog({ onCancel, onSelect }: ImportOptionsDialogProps) {
  return (
    <div className="modal-backdrop">
      <section className="restore-dialog import-options-dialog" role="dialog" aria-modal="true" aria-labelledby="import-options-title">
        <header className="modal-heading">
          <div>
            <span className="import-options-eyebrow">IMPORT</span>
            <h2 id="import-options-title">Bring your API into Play Next</h2>
            <p>Choose a source. You can review the file before anything is added.</p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>

        <div className="import-source-options">
          <button className="import-source-card" onClick={() => onSelect('postman')}>
            <span className="import-source-icon postman" aria-hidden="true">
              <svg viewBox="0 0 40 40" focusable="false">
                <circle cx="20" cy="20" r="19" fill="currentColor" />
                <path d="M11 21.5 17.5 15l5.2 5.2 6.3-6.3" fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
                <circle cx="11" cy="21.5" r="2.3" fill="white" />
                <circle cx="17.5" cy="15" r="2.3" fill="white" />
                <circle cx="22.7" cy="20.2" r="2.3" fill="white" />
                <circle cx="29" cy="13.9" r="2.3" fill="white" />
              </svg>
            </span>
            <span className="import-source-copy">
              <strong>Postman export</strong>
              <span>Bring in a collection or environment as a new resource.</span>
            </span>
            <span className="import-source-arrow" aria-hidden="true">→</span>
          </button>
          <button className="import-source-card" onClick={() => onSelect('bulk')}>
            <span className="import-source-icon bulk" aria-hidden="true">
              <img src="/assets/play-next-icon.png" alt="" />
            </span>
            <span className="import-source-copy">
              <strong>Play Next bulk import</strong>
              <span>Add folders and requests to an existing collection.</span>
            </span>
            <span className="import-source-arrow" aria-hidden="true">→</span>
          </button>
          <button className="import-source-card upcoming" disabled>
            <span className="import-source-icon openapi" aria-hidden="true">
              <svg viewBox="0 0 40 40" focusable="false">
                <path d="M20 5.5c-2.1 0-3.8 1.7-3.8 3.8 0 1 .4 1.9 1 2.6-5.1.8-8.9 5.2-8.9 10.5 0 5.9 4.8 10.7 10.7 10.7s10.7-4.8 10.7-10.7c0-5.3-3.8-9.7-8.9-10.5.6-.7 1-1.6 1-2.6 0-2.1-1.7-3.8-3.8-3.8Z" fill="none" stroke="currentColor" strokeWidth="2.2" />
                <path d="M13.5 20.5c1.4-2 3.5-3 6.5-3s5.1 1 6.5 3M15 25c1.2 1 2.9 1.5 5 1.5s3.8-.5 5-1.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
            </span>
            <span className="import-source-copy">
              <strong>OpenAPI / Swagger</strong>
              <span>Generate requests from an API definition.</span>
            </span>
            <span className="import-source-soon">Coming soon</span>
          </button>
        </div>

        <footer className="modal-actions">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </footer>
      </section>
    </div>
  )
}
