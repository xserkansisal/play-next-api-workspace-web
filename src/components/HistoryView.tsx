import { Button } from '@/components/ui/button'
import type { HistoryEntry } from '@/lib/history'

export function HistoryView({ entries, onClear }: { entries: HistoryEntry[]; onClear: () => void }) {
  return (
    <section className="trash-view">
      <div className="view-heading">
        <div>
          <h1>History</h1>
          <p>Recently sent requests, kept only in this browser. Not shared with your team and not part of any collection.</p>
        </div>
        {entries.length > 0 && <Button variant="outline" size="sm" onClick={onClear}>Clear history</Button>}
      </div>
      {entries.length === 0 ? (
        <div className="empty-workspace"><span className="response-symbol">▤</span><h2>No requests sent yet</h2><p>Send a request to see it appear here.</p></div>
      ) : (
        <div className="trash-list">
          {entries.map((entry) => (
            <div className="trash-entry history-entry" key={entry.id}>
              <div>
                <strong><span className="method-mini">{entry.method}</span> {entry.requestName ?? entry.url}</strong>
                <span>{entry.url}</span>
                <span>
                  {new Date(entry.sentAt).toLocaleString()} ·{' '}
                  {entry.failure
                    ? <span className="history-failure">Failed</span>
                    : <span className={entry.status && entry.status < 400 ? 'history-ok' : 'history-error'}>{entry.status} {entry.statusText}</span>}
                  {typeof entry.durationMs === 'number' && ` · ${Math.round(entry.durationMs)} ms`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
