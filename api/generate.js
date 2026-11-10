// Vercel serverless function: keeps your Gemini key on the server.
// Set GEMINI_API_KEY in Vercel > Project > Settings > Environment Variables.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

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

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text:
            `Idea: ${idea.trim()}\nPlatform: ${String(platform || "Instagram").slice(0, 20)}\nTone: ${String(tone || "Friendly").slice(0, 40)}` }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.8 },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data.error?.message || "Gemini error" });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return res.status(200).json(JSON.parse(text));
  } catch (e) {
    return res.status(500).json({ error: "Generation failed" });
  }
};