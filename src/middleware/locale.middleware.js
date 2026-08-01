import {
  defaultResponseCode,
  localizeApiMessage,
  normalizeLocale,
} from '../i18n/locale.js';

export function resolveRequestLocale(req, res, next) {
  const locale = normalizeLocale(req.get('accept-language'));
  req.locale = locale;
  res.locals.locale = locale;

  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      return sendJson(body);
    }

    const localizedBody = { ...body };
    if (typeof localizedBody.message === 'string') {
      localizedBody.message = localizeApiMessage(localizedBody.message, locale);
    }

    if (res.statusCode >= 400 && !localizedBody.code) {
      localizedBody.code = defaultResponseCode(res.statusCode);
    }

    return sendJson(localizedBody);
  };

  next();
}
