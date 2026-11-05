/**
 * Build a normalized integration response envelope.
 */
export function buildIntegrationResponse({
  source,
  success,
  mock = false,
  data = null,
  errors = [],
}) {
  return {
    source,
    success: Boolean(success),
    mock: Boolean(mock),
    fetchedAt: new Date().toISOString(),
    data: success ? data : null,
    errors: Array.isArray(errors) ? errors : [String(errors)],
  };
}

export async function withTimeout(promise, timeoutMs, label = 'Integration') {
  let timer;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} request timed out`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function sanitizeIntegrationError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .replace(/Bearer\s+\S+/gi, 'Bearer REDACTED')
    .replace(/Basic\s+\S+/gi, 'Basic REDACTED')
    .slice(0, 300);
}
