import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMAIL_VALIDATION_MESSAGES,
  normalizeEmail,
  validateEmailAddress,
  validateEmailDomain,
  validateEmailSyntax,
} from '../src/services/emailValidation.service.js';

function dnsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function fakeResolver({
  mxRecords = [],
  ipv4Records = [],
  ipv6Records = [],
} = {}) {
  return {
    async resolveMx() {
      if (mxRecords instanceof Error) throw mxRecords;
      return mxRecords;
    },
    async resolve4() {
      if (ipv4Records instanceof Error) throw ipv4Records;
      return ipv4Records;
    },
    async resolve6() {
      if (ipv6Records instanceof Error) throw ipv6Records;
      return ipv6Records;
    },
  };
}

test('email validation normalizes accepted email addresses', async () => {
  const result = await validateEmailAddress(
    '  Student.Name+App@Example.COM  ',
    fakeResolver({ mxRecords: [{ exchange: 'mail.example.com', priority: 10 }] })
  );

  assert.deepEqual(result, { email: 'student.name+app@example.com' });
  assert.equal(normalizeEmail(' PERSON@Example.COM '), 'person@example.com');
});

test('email syntax validation rejects malformed addresses', () => {
  const invalidEmails = [
    '',
    'student',
    'student@',
    '@example.com',
    'student@example',
    'student@@example.com',
    'student name@example.com',
    '.student@example.com',
    'student.@example.com',
    'student..name@example.com',
    'student@example..com',
    'student@-example.com',
  ];

  for (const email of invalidEmails) {
    assert.deepEqual(validateEmailSyntax(email), {
      error: EMAIL_VALIDATION_MESSAGES.invalidAddress,
    });
  }
});

test('email domain validation accepts A records when MX records are absent', async () => {
  const result = await validateEmailDomain(
    'student@example.com',
    fakeResolver({
      mxRecords: dnsError('ENODATA'),
      ipv4Records: ['192.0.2.10'],
    })
  );

  assert.deepEqual(result, { email: 'student@example.com' });
});

test('email domain validation rejects domains without mail or address records', async () => {
  const result = await validateEmailDomain(
    'student@example.com',
    fakeResolver({
      mxRecords: dnsError('ENOTFOUND'),
      ipv4Records: dnsError('ENOTFOUND'),
      ipv6Records: dnsError('ENOTFOUND'),
    })
  );

  assert.deepEqual(result, {
    error: EMAIL_VALIDATION_MESSAGES.invalidDomain,
  });
});
