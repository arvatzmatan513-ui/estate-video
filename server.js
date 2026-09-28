import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TEMPLATES, publicTemplates, cleanOptions, buildPrompt } from './templates.js';
import { isConfigured, startVideo, checkVideo } from './provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'outputs');
const PORT = Number(process.env.PORT) || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const DURATIONS = [5, 8, 10];
const RATIOS = ['9:16', '16:9'];
const MAX_ACTIVE_JOBS = 2; // הגנה מפני יצירה מרובה בטעות (וחיוב מיותר)
const POLL_MS = 5000;
const TIMEOUT_MS = 10 * 60 * 1000;
const KEEP_FILES_MS = 7 * 24 * 3600 * 1000;

await fs.mkdir(OUT_DIR, { recursive: true });
for (const f of await fs.readdir(OUT_DIR)) {
  const p = path.join(OUT_DIR, f);
  const s = await fs.stat(p);
  if (Date.now() - s.mtimeMs > KEEP_FILES_MS) await fs.unlink(p).catch(() => {});
}

/** @type {Map<string, {stage:string, progress:number|null, error:string|null, taskId:string|null}>} */
const jobs = new Map();
const isActive = (j) => ['starting', 'queued', 'running', 'saving'].includes(j.stage);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID = /^[0-9a-f-]{36}$/;

const app = express();
app.disable('x-powered-by');

function auth(req, res, next) {
  if (!ACCESS_CODE) return next();
  const given = String(req.get('x-access-code') || req.query.code || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ACCESS_CODE).digest();
  if (crypto.timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: 'unauthorized', message: 'קוד הגישה שגוי' });
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    providerConfigured: isConfigured(),
    needsCode: Boolean(ACCESS_CODE),
    durations: DURATIONS,
    ratios: RATIOS,
    templates: publicTemplates(),
  });
});

app.post('/api/generate', auth, express.json({ limit: '15mb' }), async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'provider_not_configured',
      message: 'שירות הווידאו עדיין לא מחובר בשרת (חסר מפתח API).',
    });
  }
  const { image, template, options, duration, ratio } = req.body || {};
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return res.status(400).json({ message: 'התמונה לא תקינה. נסה להעלות שוב.' });
  }
  if (!TEMPLATES[template]) return res.status(400).json({ message: 'תבנית לא מוכרת.' });
  if (!DURATIONS.includes(duration)) return res.status(400).json({ message: 'אורך סרטון לא נתמך.' });
  if (!RATIOS.includes(ratio)) return res.status(400).json({ message: 'פורמט לא נתמך.' });
  if ([...jobs.values()].filter(isActive).length >= MAX_ACTIVE_JOBS) {
    return res.status(429).json({ message: 'כבר רצות יצירות. המתן שיסתיימו ונסה שוב.' });
  }

  const id = crypto.randomUUID();
  const job = { stage: 'starting', progress: null, error: null, taskId: null };
  jobs.set(id, job);

  try {
    job.taskId = await startVideo({
      image,
      prompt: buildPrompt(template, cleanOptions(template, options)),
      ratio,
      duration,
    });
  } catch (err) {
    jobs.delete(id);
    console.error('startVideo failed:', err.status, err.message);
    const msg =
      err.status === 401
        ? 'מפתח ה-API בשרת לא תקין.'
        : err.status === 429
          ? 'הגעת למגבלת קצב או שנגמרו הקרדיטים בשירות.'
          : `שירות הווידאו החזיר שגיאה: ${err.message}`;
    return res.status(502).json({ message: msg });
  }

  job.stage = 'queued';
  pollJob(id, job); // רץ ברקע
  res.json({ id });
});

async function pollJob(id, job) {
  const started = Date.now();
  let failures = 0;
  while (isActive(job)) {
    await sleep(POLL_MS);
    if (Date.now() - started > TIMEOUT_MS) {
      job.stage = 'failed';
      job.error = 'היצירה נמשכה יותר מדי זמן. נסה שוב.';
      return;
    }
    try {
      const r = await checkVideo(job.taskId);
      failures = 0;
      if (r.status === 'queued' || r.status === 'running') {
        job.stage = r.status;
        job.progress = r.progress ?? null;
      } else if (r.status === 'failed') {
        job.stage = 'failed';
        job.error = r.error;
      } else if (r.status === 'done') {
        job.stage = 'saving';
        const dl = await fetch(r.videoUrl);
        if (!dl.ok || !dl.body) throw new Error('הורדת הסרטון מהספק נכשלה');
        await pipeline(Readable.fromWeb(dl.body), createWriteStream(path.join(OUT_DIR, `${id}.mp4`)));
        job.stage = 'done';
      }
    } catch (err) {
      console.error('poll error:', err.message);
      if (job.stage === 'saving' || ++failures >= 5) {
        job.stage = 'failed';
        job.error = `שגיאה בקבלת התוצאה: ${err.message}`;
      }
    }
  }
}

app.get('/api/jobs/:id', auth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ message: 'המשימה לא נמצאה (ייתכן שהשרת הופעל מחדש).' });
  res.json({ stage: job.stage, progress: job.progress, error: job.error });
});

app.get('/api/jobs/:id/video', auth, (req, res) => {
  const { id } = req.params;
  const file = path.join(OUT_DIR, `${id}.mp4`);
  if (!UUID.test(id) || !existsSync(file)) return res.status(404).end();
  res.sendFile(file, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition':
        req.query.download === '1' ? `attachment; filename="property-video-${id.slice(0, 8)}.mp4"` : 'inline',
    },
  });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'התמונה גדולה מדי.' });
  console.error(err);
  res.status(500).json({ message: 'שגיאת שרת.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nהאפליקציה רצה:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`מהאייפון (אותה רשת Wi‑Fi):  http://${i.address}:${PORT}`);
    }
  }
  console.log(isConfigured() ? 'שירות וידאו: מחובר' : 'שירות וידאו: לא מחובר (חסר RUNWAYML_API_SECRET) – תצוגה מקדימה בלבד');
  if (!ACCESS_CODE) console.log('שים לב: לא הוגדר ACCESS_CODE – כל מי שמגיע לכתובת יכול ליצור סרטונים על חשבונך.');
});
