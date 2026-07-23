import dns from 'node:dns/promises';

export const EMAIL_VALIDATION_MESSAGES = Object.freeze({
  invalidAddress: 'Enter a valid email address',
  invalidDomain: 'Email domain could not be verified',
});

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 253;
const LOCAL_PART_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function getEmailDomain(email) {
  const parts = normalizeEmail(email).split('@');
  return parts.length === 2 ? parts[1] : '';
}

export function validateEmailSyntax(value) {
  const email = normalizeEmail(value);

  if (!email || email.length > MAX_EMAIL_LENGTH || /\s/.test(email)) {
    return { error: EMAIL_VALIDATION_MESSAGES.invalidAddress };
  }

  const parts = email.split('@');
  if (parts.length !== 2) {
    return { error: EMAIL_VALIDATION_MESSAGES.invalidAddress };
  }

  const [localPart, domain] = parts;
  if (
    !localPart ||
    !domain ||
    localPart.length > MAX_LOCAL_PART_LENGTH ||
    domain.length > MAX_DOMAIN_LENGTH ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..') ||
    !LOCAL_PART_PATTERN.test(localPart)
  ) {
    return { error: EMAIL_VALIDATION_MESSAGES.invalidAddress };
  }

  const labels = domain.split('.');
  const topLevelDomain = labels.at(-1) ?? '';
  if (
    labels.length < 2 ||
    topLevelDomain.length < 2 ||
    labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))
  ) {
    return { error: EMAIL_VALIDATION_MESSAGES.invalidAddress };
  }

  return { email };
}

async function resolvesWith(resolver) {
  try {
    const records = await resolver();
    return Array.isArray(records) && records.length > 0;
  } catch (error) {
    if (
      ['ENODATA', 'ENOTFOUND', 'ETIMEOUT', 'ECONNREFUSED', 'SERVFAIL'].includes(
        error?.code
      )
    ) {
      return false;
    }

    throw error;
  }
}

export async function validateEmailDomain(email, resolver = dns) {
  const domain = getEmailDomain(email);
  if (!domain) {
    return { error: EMAIL_VALIDATION_MESSAGES.invalidAddress };
  }

  const hasMailExchange = await resolvesWith(() => resolver.resolveMx(domain));
  if (hasMailExchange) {
    return { email: normalizeEmail(email) };
  }

  const hasIpv4Address = await resolvesWith(() => resolver.resolve4(domain));
  if (hasIpv4Address) {
    return { email: normalizeEmail(email) };
  }

  const hasIpv6Address = await resolvesWith(() => resolver.resolve6(domain));
  if (hasIpv6Address) {
    return { email: normalizeEmail(email) };
  }

  return { error: EMAIL_VALIDATION_MESSAGES.invalidDomain };
}

export async function validateEmailAddress(value, resolver = dns) {
  const syntax = validateEmailSyntax(value);
  if (syntax.error) {
    return syntax;
  }

  return validateEmailDomain(syntax.email, resolver);
}
