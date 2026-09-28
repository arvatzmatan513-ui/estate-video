// מתאם לשירות image-to-video. כרגע: Runway API.
// כדי לעבור לשירות אחר מחליפים רק את שלוש הפונקציות בקובץ הזה:
//   isConfigured(), startVideo(), checkVideo()
// מפתח ה-API נקרא ממשתני סביבה בצד השרת בלבד ולעולם לא נשלח לדפדפן.

const BASE = 'https://api.dev.runwayml.com/v1';
const MODEL = () => process.env.RUNWAY_MODEL || 'gen4_turbo';
const RATIOS = { '9:16': '720:1280', '16:9': '1280:720' };

export const isConfigured = () => Boolean(process.env.RUNWAYML_API_SECRET);

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`,
      'X-Runway-Version': '2024-11-06',
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// יוצר משימה ומחזיר את המזהה שלה אצל הספק
export async function startVideo({ image, prompt, ratio, duration }) {
  const data = await call('/image_to_video', {
    method: 'POST',
    body: JSON.stringify({
      model: MODEL(),
      promptImage: image, // data URI של JPEG
      promptText: prompt,
      ratio: RATIOS[ratio],
      duration,
    }),
  });
  return data.id;
}

// מחזיר: { status: 'queued' | 'running' | 'done' | 'failed', progress?, videoUrl?, error? }
export async function checkVideo(taskId) {
  const t = await call(`/tasks/${taskId}`);
  switch (t.status) {
    case 'SUCCEEDED':
      return { status: 'done', videoUrl: t.output?.[0] };
    case 'FAILED':
    case 'CANCELLED':
      return { status: 'failed', error: t.failure || 'היצירה נכשלה אצל הספק' };
    case 'RUNNING':
      return { status: 'running', progress: typeof t.progress === 'number' ? t.progress : null };
    default: // PENDING, THROTTLED
      return { status: 'queued' };
  }
}
