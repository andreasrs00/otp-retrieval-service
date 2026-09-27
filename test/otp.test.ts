import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { extractOtp } from '../src/otp.js';
import { matchesSender, serializeBrowser } from '../src/gmail.js';
test('extracts contextual codes and rejects unrelated digits', () => {
  assert.equal(extractOtp('Your verification code is 482913. It expires in 5 minutes.'),'482913');
  assert.equal(extractOtp('Kode verifikasi: 732801'),'732801');
  assert.equal(extractOtp('Your order 482913 ships in 5 minutes.'),null);
  assert.equal(extractOtp('OTP: AB12CD'),'AB12CD');
});

test('sender filtering compares the opened message, not only Gmail search results', () => {
  assert.equal(matchesSender('testemailproject138@gmail.com','tidak-ada@example.com'),false);
  assert.equal(matchesSender(' TEST@Example.com ','test@example.com'),true);
  assert.equal(matchesSender('test@example.com'),true);
});

test('fetch jobs use the browser one at a time, including after a failure', async () => {
  let active = 0;
  let maximum = 0;
  const task = async (fail = false) => serializeBrowser(async () => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      if (fail) throw new Error('test failure');
    } finally {
      active--;
    }
  });
  const results = await Promise.allSettled([task(),task(true),task()]);
  assert.equal(maximum,1);
  assert.deepEqual(results.map(result => result.status),['fulfilled','rejected','fulfilled']);
});
