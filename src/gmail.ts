import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { stat } from 'node:fs/promises';
import type { Config } from './config.js';
import { ServiceError } from './errors.js';
import { extractOtp } from './otp.js';
import type { Email } from './db.js';

let queue: Promise<void> = Promise.resolve();
export function serializeBrowser<T>(work: () => Promise<T>): Promise<T> {
  const job = queue.then(work);
  queue = job.then(() => undefined, () => undefined);
  return job;
}

export async function withDeadline<T>(work: () => Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_,reject) => {
        timer = setTimeout(() => {
          try { onTimeout(); } catch { /* Return the timeout even if process termination fails. */ }
          reject(new ServiceError(504,'FETCH_TIMEOUT','Fetching the email exceeded the total timeout.'));
        },timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function matchesSender(actual: string, requested?: string): boolean {
  return !requested || actual.trim().toLowerCase() === requested.trim().toLowerCase();
}

export function assertGmailSession(url: string): void {
  if (/accounts\.google\.com|\/signin|ServiceLogin/i.test(url))
    throw new ServiceError(401,'SESSION_EXPIRED','Gmail session expired. Log in manually in Chrome Portable, close it, and retry.');
}
function assertGmail(page: Page): void { assertGmailSession(page.url()); }
function dateFromGmail(raw: string | null): Date | null {
  if (!raw) return null;
  // Gmail normally provides an absolute date/time in the expanded message header title.
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
export async function findLatestOtp(config: Config, sender?: string): Promise<Email> {
  try { await stat(config.CHROME_PORTABLE_PATH); await stat(config.CHROME_PROFILE_DIR); }
  catch { throw new ServiceError(503,'PORTABLE_CHROME_NOT_FOUND','Chrome Portable executable or profile directory does not exist.'); }
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath:config.CHROME_PORTABLE_PATH,
      userDataDir:config.CHROME_PROFILE_DIR,
      headless:false,
      args:['--no-first-run','--no-default-browser-check'],
      timeout:config.BROWSER_TIMEOUT_MS
    });
    const launchedBrowser = browser;
    return await withDeadline(async () => {
      page = await launchedBrowser.newPage();
      page.setDefaultTimeout(config.BROWSER_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(config.BROWSER_TIMEOUT_MS);
      // Start on a blank tab and navigate straight to the search route. Navigating from
      // the inbox can leave stale inbox rows visible during Gmail's SPA transition.
      const from = sender ? ` from:(${sender})` : '';
      const query = `in:anywhere${from} {"verification code" "security code" "login code" "one-time code" "OTP" "kode verifikasi"}`;
      const base = config.GMAIL_URL.split('#')[0] ?? config.GMAIL_URL;
      await page.goto(`${base}#search/${encodeURIComponent(query)}`,{waitUntil:'domcontentloaded',timeout:config.BROWSER_TIMEOUT_MS});
      assertGmail(page);
      try {
        await page.waitForFunction(() => {
          if (location.hostname === 'accounts.google.com') return true;
          if (document.querySelector('tr.zA')) return true;
          const main = document.querySelector('[role="main"]')?.textContent ?? '';
          return /no conversations found|no results found|no emails found|tidak ada percakapan|tidak ada hasil|tidak ada email/i.test(main);
        },{timeout:config.BROWSER_TIMEOUT_MS});
      } catch { assertGmail(page); throw new ServiceError(504,'GMAIL_TIMEOUT','Gmail search did not load before the timeout.'); }
      assertGmail(page);
      const rows = await page.$$('tr.zA');
      if (!rows.length) throw new ServiceError(404,'EMAIL_NOT_FOUND','No matching OTP email found.');
      let foundWithoutOtp = false;
      let foundMatchingSender = false;
      for (let index=0; index<Math.min(rows.length,20); index++) {
        const currentRows = await page.$$('tr.zA');
        const row = currentRows[index];
        if (!row) break;
        await row.click();
        assertGmail(page);
        await page.waitForSelector('.adn.ads, .a3s.aiL',{visible:true,timeout:config.BROWSER_TIMEOUT_MS});
        const message = await page.evaluate(() => {
          const blocks = Array.from(document.querySelectorAll<HTMLElement>('.adn.ads'));
          const block = blocks.at(-1);
          const body = block?.querySelector<HTMLElement>('.a3s.aiL')?.innerText?.trim() ?? '';
          const senderElement = block?.querySelector<HTMLElement>('.gD[email]');
          const sender = senderElement?.getAttribute('email') ?? '';
          const subject = document.querySelector<HTMLElement>('h2.hP')?.innerText?.trim() ?? '';
          const dateElement = block?.querySelector<HTMLElement>('.g3[title], .g3[aria-label], span[title]');
          const sent = dateElement?.getAttribute('title') ?? dateElement?.getAttribute('aria-label') ?? '';
          const idElement = block?.closest('[data-legacy-message-id], [data-message-id]');
          const messageId = idElement?.getAttribute('data-legacy-message-id') ?? idElement?.getAttribute('data-message-id') ?? '';
          return {body,sender,subject,sent,messageId};
        });
        if (!message.sender) throw new ServiceError(502,'GMAIL_METADATA_UNAVAILABLE','Gmail did not expose the sender address.');
        if (!matchesSender(message.sender,sender)) {
          await page.goBack({waitUntil:'domcontentloaded',timeout:config.BROWSER_TIMEOUT_MS});
          assertGmail(page);
          await page.waitForSelector('tr.zA',{visible:true,timeout:config.BROWSER_TIMEOUT_MS});
          continue;
        }
        foundMatchingSender = true;
        const code = extractOtp(message.body);
        if (code && message.messageId) {
          const sentAt = dateFromGmail(message.sent);
          if (!sentAt) throw new ServiceError(422,'EMAIL_DATE_UNAVAILABLE','Gmail did not expose a parseable sent date for this email.');
          return {gmailMessageId:message.messageId,sender:message.sender,subject:message.subject,body:message.body,sentAt,code};
        }
        if (!code) foundWithoutOtp = true;
        else throw new ServiceError(502,'GMAIL_METADATA_UNAVAILABLE','Gmail did not expose a sender or message ID.');
        await page.goBack({waitUntil:'domcontentloaded',timeout:config.BROWSER_TIMEOUT_MS});
        assertGmail(page);
        await page.waitForSelector('tr.zA',{visible:true,timeout:config.BROWSER_TIMEOUT_MS});
      }
      throw new ServiceError(foundMatchingSender && foundWithoutOtp ? 422 : 404,foundMatchingSender && foundWithoutOtp ? 'OTP_NOT_RECOGNIZED' : 'EMAIL_NOT_FOUND',foundMatchingSender && foundWithoutOtp ? 'Matching emails were found, but no recognizable OTP appeared in the inspected messages.' : 'No matching OTP email found.');
    },config.FETCH_TIMEOUT_MS,() => browser?.process()?.kill());
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (page) assertGmail(page);
    if (error instanceof Error && /browser is already running for|profile.*in use/i.test(error.message))
      throw new ServiceError(409,'PROFILE_IN_USE','Close Chrome Portable completely before fetching; its profile is still in use.');
    throw new ServiceError(503,'BROWSER_ERROR',error instanceof Error ? `Chrome Portable/Gmail failed: ${error.message}` : 'Chrome Portable/Gmail failed.');
  } finally {
    if (browser) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          browser.close(),
          new Promise<never>((_,reject) => { timer = setTimeout(() => reject(new Error('Browser close timeout')),5000); })
        ]);
      } catch {
        browser.process()?.kill();
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
}
