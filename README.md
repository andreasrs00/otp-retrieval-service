# OTP retrieval service

Node.js 20+, TypeScript strict mode, PostgreSQL, Puppeteer Core and a manually authenticated Chrome Portable profile. This is a local demo service: bind it behind authentication before exposing it to a network, because API responses include OTPs and message bodies.

## Setup (Windows / Chrome Portable)

1. Install **Google Chrome Portable** from PortableApps.com. Find its actual Chrome executable (typically under `GoogleChromePortable/App/Chrome-bin/chrome.exe`; inspect your installation). Do not point at installed Chrome or Puppeteer's Chromium.
2. Start Chrome Portable normally and log in to a **new throwaway Gmail account** manually. Complete any challenge yourself. Visit Gmail, then **fully close Chrome Portable**. Chrome cannot share an active user data directory with a second Chrome process. Never copy the profile into this repository.
3. Copy `.env.example` to `.env`. Set `CHROME_PORTABLE_PATH` to the Chrome Portable executable and `CHROME_PROFILE_DIR` to its **actual Chrome user data directory** (commonly `GoogleChromePortable/Data/profile`; inspect `chrome://version` → *Profile Path* and use its parent directory). Set `DATABASE_URL` to your local PostgreSQL URL. The default Gmail URL targets account 0; change it if necessary. No credentials or cookies belong in `.env.example` or git.
4. Create a PostgreSQL database and run:

```sh
npm ci
npm run migrate
npm run build
npm test
npm start
```

For development, use `npm run dev`. `npm run migrate` is idempotent. Send an email to the throwaway Gmail account with body `Your verification code is 482913. It expires in 5 minutes.` You may send it from that account to itself.

## API

```sh
curl -X POST http://localhost:3000/otps/fetch -H 'Content-Type: application/json' -d '{}'
curl -X POST http://localhost:3000/otps/fetch -H 'Content-Type: application/json' -d '{"sender":"sender@example.com"}'
curl 'http://localhost:3000/otps?page=1&limit=20'
curl http://localhost:3000/otps/1
curl -X DELETE http://localhost:3000/otps/1
curl http://localhost:3000/health
```

Fetch returns `201` with the inserted row, or `200` with the existing row when the Gmail message ID already exists. List returns `{data,page,limit,total}`, newest email sent time first. Page defaults to 1, limit defaults to 20 and maxes out at 100. Get/delete return `404` for missing IDs. Fetch reports `404 EMAIL_NOT_FOUND`, `422 OTP_NOT_RECOGNIZED`, `401 SESSION_EXPIRED`, `409 PROFILE_IN_USE`, `504 GMAIL_TIMEOUT`, or `503 BROWSER_ERROR` as appropriate. A single process serializes fetches; PostgreSQL's unique Gmail message ID constraint protects against duplicates across processes. A production deployment with multiple service workers should add a distributed lock around the shared profile.

## Extraction and limitations

Gmail search matches common code phrases and optionally `from:(address)`, then inspects up to 20 newest search results. It opens the search route on a fresh tab, waits for the expected query to appear in Gmail's search field, and checks the opened message's actual sender against the requested address. It scans the visible plain text for a contextual 4–8 character code containing a digit (English and Indonesian labels). The code deliberately avoids guessing arbitrary numbers. HTML is converted to visible text by Gmail; forwarded or quoted messages can confuse extraction. The last expanded message in a conversation is inspected; a thread with several messages or a different locale may require a more precise message selection strategy. The 20-result bound means this is not an exhaustive search if there are many unrelated messages. Gmail search ordering and internal DOM classes are not a supported API and may change. Gmail's displayed header date must be parseable by JavaScript as an absolute date; if it is not, the service returns an error instead of substituting insert time. Check sender, subject, sent date and extracted code during the demo.

The browser opens as a visible window using the configured portable executable and profile. The service never enters credentials, and it closes its browser even after errors; if graceful close stalls it terminates the launched process. Do not leave a second copy of Chrome Portable running against the same profile. The in-memory queue serializes requests **within this Node.js process only**. Gmail is accessed through its UI, so a Google sign-in challenge must be resolved manually in portable Chrome before retrying. `GMAIL_URL` should match the signed-in mailbox. The project has been built and unit tested without access to a logged-in Gmail session, so a real browser run is required before claiming the Gmail selectors, sent date parsing, or the complete fetch workflow work in your locale/account.

`BROWSER_TIMEOUT_MS` limits individual browser waits and launch; `FETCH_TIMEOUT_MS` limits the work after launch. On the total deadline the launched browser process is terminated and the API returns `504 FETCH_TIMEOUT`. A queued request waits for its turn. The timeout does not cover a stalled PostgreSQL server or a stalled browser launch beyond Puppeteer's own launch timeout.

## Tests and evidence

Run `npm test` for nine automated tests. `test/cases.test.ts` uses controlled replacements for Gmail and the database to check API responses for no email (404), no OTP (422), duplicate (201 then 200), simultaneous requests, expired session (401), and total deadline (504). `test/otp.test.ts` checks OTP extraction, exact sender comparison, and queue behavior after failure. These tests do **not** prove Gmail's live DOM selectors, Chrome Portable startup, browser process termination on Windows, or PostgreSQL's actual unique constraint. Verify those using the throwaway account and real database before submission.

Live verification sequence:

1. Send a new dummy OTP email and fetch it (`201`), compare its sender/body/sent date to Gmail and its stored row to PostgreSQL.
2. Fetch the same message again (`200`), and confirm the table still contains only one row for its Gmail message ID.
3. Fetch with `{"sender":"nobody@example.com"}` (`404`), then with the real sender (the matching row).
4. With a clean test inbox containing only a keyword-matching email **without a code**, fetch and expect `422`. An older valid OTP in the first 20 search results would be selected instead.
5. Send two fetch requests concurrently. Both should complete without a profile lock; verify one browser process controls the profile at a time.
6. Sign out manually in Chrome Portable, close it, fetch, and expect `401` without automated login. Sign back in manually for later checks.
7. Verify timeout using a deliberately slow test environment and confirm Chrome Portable exits. Lowering `FETCH_TIMEOUT_MS` alone may not trigger a timeout on a fast machine.

## Screen recording checklist (3–5 minutes)

1. Show Chrome Portable open on the throwaway inbox and send a dummy OTP email to it; close Chrome Portable before the API fetch.
2. Show `POST /otps/fetch` and the returned `201` row.
3. Show `SELECT id,sender_email,email_subject,email_sent_at,otp_code FROM otp_emails ORDER BY id DESC;` in PostgreSQL.
4. Show `GET /otps?page=1&limit=10`, `GET /otps/:id`, `DELETE /otps/:id`, then `GET /otps/:id` returning 404. Optionally fetch twice to show the 200 duplicate response.
5. Mask addresses if needed and never show passwords, cookies, or environment secrets.

This repository supplies the application and instructions. The throwaway Gmail session, live browser demonstration, recording, and externally hosted repository must be created in an environment with Chrome Portable, PostgreSQL, screen capture, and an account under your control.
