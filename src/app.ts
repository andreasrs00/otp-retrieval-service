import express, { type ErrorRequestHandler } from 'express';
import { z, ZodError } from 'zod';
import type { Config } from './config.js';
import { createDb } from './db.js';
import { ServiceError } from './errors.js';
import { findLatestOtp, serializeBrowser } from './gmail.js';

const senderSchema = z.string().email().max(320);
const idSchema = z.string().regex(/^[1-9]\d*$/);
const pagination = z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)});
export function createApp(config: Config, db: ReturnType<typeof createDb>, fetchEmail: typeof findLatestOtp = findLatestOtp) {
  const app = express();
  app.use(express.json({limit:'16kb'}));
  app.get('/health',async (_req,res,next) => { try { await db.health(); res.json({status:'ok'}); } catch(e) { next(e); } });
  app.post('/otps/fetch',async (req,res,next) => {
    try {
      const body = z.object({sender:senderSchema.optional()}).strict().parse(req.body ?? {});
      const result = await serializeBrowser(async () => db.insert(await fetchEmail(config,body.sender)));
      res.status(result.created ? 201 : 200).json(result.row);
    } catch(e) { next(e); }
  });
  app.get('/otps',async (req,res,next) => {
    try { const {page,limit}=pagination.parse(req.query); res.json(await db.list(page,limit)); }
    catch(e) { next(e); }
  });
  app.get('/otps/:id',async (req,res,next) => {
    try { const row=await db.get(idSchema.parse(req.params.id)); if (!row) throw new ServiceError(404,'NOT_FOUND','OTP not found.'); res.json(row); }
    catch(e) { next(e); }
  });
  app.delete('/otps/:id',async (req,res,next) => {
    try { const row=await db.remove(idSchema.parse(req.params.id)); if (!row) throw new ServiceError(404,'NOT_FOUND','OTP not found.'); res.json(row); }
    catch(e) { next(e); }
  });
  const errors:ErrorRequestHandler=(err:unknown,_req,res,_next) => {
    if (err instanceof ServiceError) { res.status(err.status).json({error:err.code,message:err.message}); return; }
    if (err instanceof ZodError) { res.status(400).json({error:'INVALID_REQUEST',message:err.issues.map(x=>x.message).join('; ')}); return; }
    if (err instanceof SyntaxError && 'body' in err) { res.status(400).json({error:'INVALID_JSON',message:'Invalid JSON body.'}); return; }
    console.error(err);
    res.status(500).json({error:'INTERNAL_ERROR',message:'Internal server error.'});
  };
  app.use(errors);
  return app;
}
