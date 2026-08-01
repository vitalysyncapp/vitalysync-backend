const SUPPORTED_LOCALES = new Set(['en', 'fil']);

const TAGALOG_MESSAGES = new Map([
  ['Authentication token required', 'Kailangan mong mag-sign in para magpatuloy.'],
  ['Invalid or expired authentication token', 'Invalid o expired na ang sign-in session mo. Mag-sign in ulit.'],
  ['Authenticated user does not match requested user', 'Hindi tugma ang naka-sign in na user sa request.'],
  ['Invalid credentials', 'Hindi tama ang email o password.'],
  ['Email and password required', 'Kailangan ang email at password.'],
  ['Email is required', 'Kailangan ang email.'],
  ['Passwords do not match.', 'Hindi magkapareho ang mga password.'],
  ['User not found', 'Hindi makita ang user.'],
  ['Exercise goal not found', 'Hindi makita ang exercise goal.'],
  ['Nutrition attempt not found', 'Hindi makita ang nutrition entry.'],
  ['Nudge event not found', 'Hindi makita ang nudge.'],
  ['Notification event not found', 'Hindi makita ang notification.'],
  ['Email or username already exists', 'May gumagamit na ng email o username na ito.'],
  ['User created successfully', 'Nagawa na ang account mo.'],
  ['Login successful', 'Naka-sign in ka na.'],
  ['Profile updated successfully', 'Na-update na ang profile mo.'],
  ['Goals updated successfully', 'Na-update na ang goals mo.'],
  ['Reminder preferences saved successfully', 'Na-save na ang reminder preferences mo.'],
  ['Nutrition log saved successfully', 'Na-save na ang nutrition log mo.'],
  ['Nutrition attempt discarded', 'Inalis na ang nutrition draft.'],
  ['Nutrition analysis ready for review', 'Ready na ang nutrition analysis para i-review.'],
  ['Onboarding submitted successfully', 'Na-save na ang wellness setup mo.'],
  ['Wellness profile updated successfully', 'Na-update na ang wellness profile mo.'],
  ['Preferences created successfully', 'Na-save na ang preferences mo.'],
  ['Preferences updated successfully', 'Na-update na ang preferences mo.'],
  ['Email is already verified.', 'Verified na ang email mo.'],
  ['Email verified successfully.', 'Verified na ang email mo.'],
  ['Code verified. Choose a new password.', 'Verified ang code. Pumili ng bagong password.'],
  ['Password changed successfully. Sign in again with your new password.', 'Napalitan na ang password. Mag-sign in ulit gamit ang bagong password mo.'],
  ['Request body is too large', 'Masyadong malaki ang ipinadalang data.'],
  ['Invalid request', 'May hindi valid sa request.'],
  ['Unexpected server error', 'May pansamantalang problema sa server. Pakisubukan ulit.'],
]);

const STATUS_CODES = new Map([
  [400, 'VALIDATION_ERROR'],
  [401, 'AUTHENTICATION_REQUIRED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [409, 'CONFLICT'],
  [413, 'PAYLOAD_TOO_LARGE'],
  [429, 'RATE_LIMITED'],
  [500, 'SERVER_ERROR'],
  [502, 'UPSTREAM_ERROR'],
  [503, 'SERVICE_UNAVAILABLE'],
]);

export function normalizeLocale(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'en';

  const requested = value
    .split(',')
    .map((part) => part.trim().split(';')[0].toLowerCase())
    .filter(Boolean);

  for (const languageTag of requested) {
    const base = languageTag.split('-')[0];
    if (base === 'tl' || base === 'fil') return 'fil';
    if (SUPPORTED_LOCALES.has(base)) return base;
  }
  return 'en';
}

export function localizeApiMessage(message, locale) {
  if (normalizeLocale(locale) !== 'fil' || typeof message !== 'string') {
    return message;
  }

  const exact = TAGALOG_MESSAGES.get(message);
  if (exact) return exact;

  if (/^Valid .+ (?:is|are) required$/.test(message)) {
    return 'May kulang o hindi valid na detalye sa request.';
  }
  if (/^Invalid .+ value$/.test(message)) {
    return 'May hindi valid na piniling value.';
  }
  if (/^Failed to /.test(message) || /^Unable to /.test(message)) {
    return 'Hindi ito makumpleto ngayon. Pakisubukan ulit.';
  }
  if (/^Too many requests\./.test(message)) {
    return 'Masyadong maraming request. Maghintay sandali bago subukan ulit.';
  }

  return message;
}

export function defaultResponseCode(statusCode) {
  if (STATUS_CODES.has(statusCode)) return STATUS_CODES.get(statusCode);
  if (statusCode >= 500) return 'SERVER_ERROR';
  if (statusCode >= 400) return 'REQUEST_ERROR';
  return null;
}
