// instrumentation-client.ts
// Runs in the browser before the app is interactive: report uncaught errors
// and unhandled promise rejections (see lib/report-error.ts).
import { reportClientError } from '@/lib/report-error'

try {
  window.addEventListener('error', (event) => {
    // Resource load failures (a broken image) have no error object; skip them.
    if (event.error) reportClientError('window-error', event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError('unhandled-rejection', event.reason)
  })
} catch {
  // Never let monitoring break the page.
}
