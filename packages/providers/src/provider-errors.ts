/**
 * Thrown when a provider reports that an async task itself reached a
 * terminal failure — `failed`, `cancelled`, `expired`, or `succeeded` with
 * no output. Polling again cannot change it.
 *
 * The distinction matters to the worker: a transient polling error (a
 * network blip, a 5xx) is worth another poll, but an uncaught throw out of
 * the Trigger.dev run makes the platform retry the WHOLE job — and a retry
 * submits the generation to the provider again. Terminal failures carry
 * this type so the worker can fail the job straight away instead.
 */
export class ProviderTaskFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTaskFailedError';
  }
}

/** `instanceof`, plus a name check in case two copies of the class are bundled. */
export function isProviderTaskFailedError(err: unknown): err is ProviderTaskFailedError {
  return (
    err instanceof ProviderTaskFailedError ||
    (err instanceof Error && err.name === 'ProviderTaskFailedError')
  );
}
