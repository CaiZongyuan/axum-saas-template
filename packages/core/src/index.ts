/** Extract the server's public correlation identifier without exposing arbitrary error text. */
export function requestIdFromError(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return;
  const body = value.error;
  if (typeof body !== 'object' || body === null || !('request_id' in body))
    return;
  return typeof body.request_id === 'string' ? body.request_id : undefined;
}
