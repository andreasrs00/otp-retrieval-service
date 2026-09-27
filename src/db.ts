import pg from 'pg';
import { ServiceError } from './errors.js';

export interface OtpRow {
  id: string; gmail_message_id: string; sender_email: string; email_subject: string;
  email_body: string; email_sent_at: Date; otp_code: string; created_at: Date;
}
export interface Email { gmailMessageId: string; sender: string; subject: string; body: string; sentAt: Date; code: string }
export function createDb(url: string) {
  const pool = new pg.Pool({connectionString:url});
  const columns = 'id, sender_email, email_subject, email_body, email_sent_at, otp_code, created_at';
  return {
    async insert(email: Email): Promise<{row: OtpRow; created: boolean}> {
      const inserted = await pool.query<OtpRow>(`INSERT INTO otp_emails (gmail_message_id,sender_email,email_subject,email_body,email_sent_at,otp_code) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (gmail_message_id) DO NOTHING RETURNING ${columns}`,
        [email.gmailMessageId,email.sender,email.subject,email.body,email.sentAt,email.code]);
      if (inserted.rows[0]) return {row: inserted.rows[0],created:true};
      const prior = await pool.query<OtpRow>(`SELECT ${columns} FROM otp_emails WHERE gmail_message_id=$1`,[email.gmailMessageId]);
      if (!prior.rows[0]) throw new ServiceError(503,'DB_CONFLICT','Could not retrieve the saved email; retry.');
      return {row:prior.rows[0],created:false};
    },
    async list(page:number,limit:number) {
      const [rows,count] = await Promise.all([
        pool.query<OtpRow>(`SELECT ${columns} FROM otp_emails ORDER BY email_sent_at DESC, id DESC LIMIT $1 OFFSET $2`,[limit,(page-1)*limit]),
        pool.query<{count:string}>('SELECT count(*) FROM otp_emails')
      ]);
      return {data:rows.rows,page,limit,total:Number(count.rows[0]?.count ?? 0)};
    },
    async get(id:string) { return (await pool.query<OtpRow>(`SELECT ${columns} FROM otp_emails WHERE id=$1`,[id])).rows[0] ?? null; },
    async remove(id:string) { return (await pool.query<OtpRow>(`DELETE FROM otp_emails WHERE id=$1 RETURNING ${columns}`,[id])).rows[0] ?? null; },
    async health() { await pool.query('SELECT 1'); },
    async close() { await pool.end(); }
  };
}
