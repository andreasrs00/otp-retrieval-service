import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ServiceError } from '../src/errors.js';
import { assertGmailSession, withDeadline } from '../src/gmail.js';
import type { Config } from '../src/config.js';
import type { Email, OtpRow, createDb } from '../src/db.js';

const config: Config = {
  PORT:3000,DATABASE_URL:'test-only',CHROME_PORTABLE_PATH:'test-only',
  CHROME_PROFILE_DIR:'test-only',GMAIL_URL:'https://mail.google.com/mail/u/0/#all',
  BROWSER_TIMEOUT_MS:1000,FETCH_TIMEOUT_MS:1000
};
const email: Email = {
  gmailMessageId:'message-1',sender:'sender@example.com',subject:'Your login code',
  body:'Your verification code is 482913.',sentAt:new Date('2026-09-24T07:10:22Z'),code:'482913'
};
function fakeDb() {
  let nextId=1;
  const rows=new Map<string,OtpRow>();
  const ids=new Map<string,string>();
  return {
    async insert(value: Email) {
      const oldId=ids.get(value.gmailMessageId);
      if (oldId) return {row:rows.get(oldId)!,created:false};
      const id=String(nextId++);
      const row: OtpRow={
        id,gmail_message_id:value.gmailMessageId,sender_email:value.sender,
        email_subject:value.subject,email_body:value.body,email_sent_at:value.sentAt,
        otp_code:value.code,created_at:new Date('2026-09-24T07:10:30Z')
      };
      rows.set(id,row); ids.set(value.gmailMessageId,id);
      return {row,created:true};
    },
    async list(page:number,limit:number) {
      const all=[...rows.values()].sort((a,b)=>b.email_sent_at.getTime()-a.email_sent_at.getTime());
      return {data:all.slice((page-1)*limit,page*limit),page,limit,total:all.length};
    },
    async get(id:string) { return rows.get(id) ?? null; },
    async remove(id:string) { const row=rows.get(id) ?? null; rows.delete(id); return row; },
    async health() { return; },
    async close() { return; },
    count() { return rows.size; }
  };
}
function appFor(fetchEmail: (config:Config,sender?:string)=>Promise<Email>, db=fakeDb()) {
  return {app:createApp(config,db as unknown as ReturnType<typeof createDb>,fetchEmail),db};
}

test('no matching email returns a clear 404 without an insert',async () => {
  const {app,db}=appFor(async () => { throw new ServiceError(404,'EMAIL_NOT_FOUND','No matching OTP email found.'); });
  const response=await request(app).post('/otps/fetch').send({sender:'nobody@example.com'});
  assert.equal(response.status,404);
  assert.equal(response.body.error,'EMAIL_NOT_FOUND');
  assert.equal(db.count(),0);
});

test('matching email without recognizable OTP returns 422 without an insert',async () => {
  const {app,db}=appFor(async () => { throw new ServiceError(422,'OTP_NOT_RECOGNIZED','Matching email has no code.'); });
  const response=await request(app).post('/otps/fetch').send({});
  assert.equal(response.status,422);
  assert.equal(response.body.error,'OTP_NOT_RECOGNIZED');
  assert.equal(db.count(),0);
});

test('the same message returns 201 then 200 with just one stored row',async () => {
  const {app,db}=appFor(async () => email);
  const first=await request(app).post('/otps/fetch').send({});
  const second=await request(app).post('/otps/fetch').send({});
  assert.equal(first.status,201);
  assert.equal(second.status,200);
  assert.equal(second.body.id,first.body.id);
  assert.equal(db.count(),1);
  const list=await request(app).get('/otps?page=1&limit=10');
  assert.equal(list.body.total,1);
  assert.equal((await request(app).get(`/otps/${first.body.id}`)).status,200);
  assert.equal((await request(app).delete(`/otps/${first.body.id}`)).status,200);
  assert.equal((await request(app).get(`/otps/${first.body.id}`)).status,404);
});

test('simultaneous API fetches do not drive the browser together',async () => {
  let active=0,maximum=0;
  const {app}=appFor(async () => {
    active++; maximum=Math.max(maximum,active);
    try { await new Promise<void>(resolve => setTimeout(resolve,20)); return email; }
    finally { active--; }
  });
  const responses=await Promise.all([request(app).post('/otps/fetch').send({}),request(app).post('/otps/fetch').send({})]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,201]);
  assert.equal(maximum,1);
});

test('expired Gmail session is detected and returns 401 without logging in',async () => {
  assert.throws(()=>assertGmailSession('https://accounts.google.com/ServiceLogin'),(error:unknown)=>error instanceof ServiceError && error.code==='SESSION_EXPIRED');
  const {app}=appFor(async () => { throw new ServiceError(401,'SESSION_EXPIRED','Log in manually.'); });
  const response=await request(app).post('/otps/fetch').send({});
  assert.equal(response.status,401);
  assert.equal(response.body.error,'SESSION_EXPIRED');
});

test('total deadline returns 504, triggers browser termination callback and reports API error',async () => {
  let terminated=false;
  await assert.rejects(withDeadline(()=>new Promise<never>(()=>{}),20,()=>{terminated=true;}),
    (error:unknown)=>error instanceof ServiceError && error.code==='FETCH_TIMEOUT');
  assert.equal(terminated,true);
  const {app}=appFor(async () => { throw new ServiceError(504,'FETCH_TIMEOUT','Fetching exceeded timeout.'); });
  const response=await request(app).post('/otps/fetch').send({});
  assert.equal(response.status,504);
  assert.equal(response.body.error,'FETCH_TIMEOUT');
});
