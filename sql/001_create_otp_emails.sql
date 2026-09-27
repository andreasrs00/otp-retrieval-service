CREATE TABLE IF NOT EXISTS otp_emails (
  id BIGSERIAL PRIMARY KEY,
  gmail_message_id TEXT NOT NULL UNIQUE,
  sender_email VARCHAR(320) NOT NULL,
  email_subject TEXT NOT NULL,
  email_body TEXT NOT NULL,
  email_sent_at TIMESTAMPTZ NOT NULL,
  otp_code VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_emails_sent_idx ON otp_emails (email_sent_at DESC, id DESC);
