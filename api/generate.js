// Vercel serverless function: keeps your Gemini key on the server.
// Env vars (Vercel > Settings > Environment Variables):
//   GEMINI_API_KEY  (required)
//   GEMINI_MODEL    (optional, defaults to gemini-4-argon)

const PRIMARY = process.env.GEMINI_MODEL || "gemini-4-argon";
// Tried in order. If the first is busy or unavailable, the next one is used.
const MODELS = [...new Set([PRIMARY, "gemini-3.8-flash"])];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHEMA = {
  type: "OBJECT",
  properties: {
    slides: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["cover", "point", "cta"] },
          headline: { type: "STRING" },
          body: { type: "STRING" },
          button: { type: "STRING" },
        },
        required: ["type", "headline", "body"],
      },
    },
    caption: { type: "STRING" },
  },
  required: ["slides", "caption"],
};

const SYSTEM = `You are a senior social media copywriter. Turn the user's rough idea into a high-quality carousel.
Rules:
- Exactly one "cover" slide first, then 5 "point" slides, then one "cta" slide last (7 total).
- Cover: a scroll-stopping hook, max 9 words. Body: a short promise, max 10 words.
- Point slides: headline max 8 words, body one clear sentence of max 22 words. Each point must be accurate and useful.
- CTA slide: headline max 6 words, body max 14 words, and "button" max 5 words.
- Caption: 2 to 3 short sentences, a save/share prompt, then 5 relevant hashtags.
- Match the requested tone and platform. Never invent statistics. Plain English, no jargon.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });

  const { idea, tone, platform } = req.body || {};
  if (typeof idea !== "string" || idea.trim().length < 8 || idea.length > 800)
    return res.status(400).json({ error: "Idea must be 8 to 800 characters" });

  const prompt = `Idea: ${idea.trim()}\nPlatform: ${String(platform || "Instagram").slice(0, 20)}\nTone: ${String(tone || "Friendly").slice(0, 40)}`;

  const bodyFor = (model) => {
    const generationConfig = {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 8192,
    };
    // Gemini 4 Argon: low thinking = fast. (It ignores temperature, so none is set.)
    if (model.startsWith("gemini-4")) generationConfig.thinkingConfig = { thinkingLevel: "low" };
    return JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    });
  };

  const t0 = Date.now();
  let lastError = "Gemini is busy";
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - t0 > 40000) break; // stay under the function time limit
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: bodyFor(model),
            signal: AbortSignal.timeout(25000),
          }
        );
        const data = await r.json();
        if (r.ok) {
          const text = data.candidates?.[0]?.content?.parts?.find((p) => p.text && !p.thought)?.text;
          if (text) return res.status(200).json(JSON.parse(text));
          lastError = `${model}: empty response`;
          break;
        }
        lastError = `${model}: ${data.error?.message || r.status}`;
        console.error("Gemini error", r.status, lastError);
        if (r.status === 429 || r.status >= 500) { await sleep(800); continue; } // busy: retry once
        break; // bad model, key or billing: try the next model
      } catch (e) {
        lastError = `${model}: ${e.message}`;
        console.error("Request failed", lastError);
        break;
      }
    }
  }
  return res.status(502).json({ error: lastError });
};