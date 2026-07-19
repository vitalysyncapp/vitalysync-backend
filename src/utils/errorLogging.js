function errorSummary(error) {
  return {
    name: error?.name ?? 'Error',
    code: error?.code,
  };
}

export function logApiError(req, label, error) {
  console.error(label, {
    request_id: req?.requestId,
    method: req?.method,
    path: req?.path,
    error: errorSummary(error),
  });
}
