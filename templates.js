// כאן מוגדרים הפרומפטים הקבועים של התבניות (באנגלית, כי מודלי וידאו מבינים אותה הכי טוב).
// כדי לשנות תבנית או להוסיף חדשה – עורכים רק את הקובץ הזה (ואת האיור שלה ב-public/index.html).

const AMOUNT = {
  low: 'very subtle',
  medium: 'gentle',
  high: 'pronounced but still smooth',
};

// משפט השימור – מתווסף לכל תבנית. הוא מנסה לשמור על המבנה, אבל אינו מבטיח זאת.
const PRESERVE =
  'Keep the property exactly as in the photo: identical architecture, walls, roofline, windows, doors, balconies, proportions, materials and colors. Photorealistic, natural look, no people, no text, no added or removed objects.';

const INTENSITY = {
  key: 'intensity',
  label: 'עוצמת התנועה',
  default: 'low', // ברירת מחדל עדינה = פחות סיכוי לעיוות של הנכס
  choices: [
    { v: 'low', l: 'עדינה' },
    { v: 'medium', l: 'בינונית' },
    { v: 'high', l: 'חזקה' },
  ],
};

export const TEMPLATES = {
  day_to_night: {
    name: 'יום ללילה',
    description: 'השמיים מחשיכים והתאורה בבית נדלקת',
    options: [],
    build: () =>
      'Time-lapse from daytime to night. The sky gradually darkens from daylight through golden hour to deep blue twilight. As it gets darker, the interior and exterior lights of the house turn on one after another and glow warmly through the windows. The camera is locked off and completely static.',
  },

  push_in: {
    name: 'התקרבות עדינה',
    description: 'המצלמה נעה לאט פנימה, לכיוון הנכס',
    options: [INTENSITY],
    build: (o) =>
      `A ${AMOUNT[o.intensity]}, slow cinematic dolly-in toward the property. The camera glides forward in a straight, steady line with no rotation. Everything in the scene stays still and rigid.`,
  },

  pan: {
    name: 'תנועה הצידה',
    description: 'המצלמה מחליקה לצד, עם עומק טבעי',
    options: [
      INTENSITY,
      {
        key: 'direction',
        label: 'כיוון',
        default: 'right',
        choices: [
          { v: 'right', l: 'ימינה' },
          { v: 'left', l: 'שמאלה' },
        ],
      },
    ],
    build: (o) =>
      `A ${AMOUNT[o.intensity]}, slow lateral camera slide to the ${o.direction}. The camera moves sideways in a steady line with natural parallax and no rotation, keeping the horizon level and all vertical lines straight. The scene itself stays still.`,
  },

  clouds: {
    name: 'עננים ותאורה',
    description: 'עננים נעים והאור משתנה בעדינות',
    options: [INTENSITY],
    build: (o) =>
      `Clouds drift slowly across the sky with ${AMOUNT[o.intensity]} motion, and the sunlight shifts softly, so light and shadows on the house change gradually. The camera is locked off and completely static. The house and everything built stays perfectly still.`,
  },
};

const defaultsOf = (t) => Object.fromEntries(t.options.map((op) => [op.key, op.default]));

export function publicTemplates() {
  return Object.entries(TEMPLATES).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    options: t.options,
  }));
}

// מאמת את ההגדרות שהגיעו מהדפדפן ומחזיר רק ערכים מותרים
export function cleanOptions(id, given = {}) {
  const t = TEMPLATES[id];
  const out = defaultsOf(t);
  for (const op of t.options) {
    const v = given[op.key];
    if (op.choices.some((c) => c.v === v)) out[op.key] = v;
  }
  return out;
}

export function buildPrompt(id, options) {
  const t = TEMPLATES[id];
  return `${t.build(cleanOptions(id, options))} ${PRESERVE}`;
}

// בדיקה בעת עליית השרת: הפרומפט חייב להיות עד 1000 תווים
for (const id of Object.keys(TEMPLATES)) {
  const len = buildPrompt(id, {}).length;
  if (len > 1000) throw new Error(`הפרומפט של ${id} ארוך מדי (${len})`);
}
