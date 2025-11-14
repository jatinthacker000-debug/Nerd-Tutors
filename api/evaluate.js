// api/evaluate.js
export default async function handler(req, res) {
  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*'); // change to your domain in production
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    console.warn('Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed', method: req.method });
  }

  try {
    const { question, modelAnswer, studentAnswer, maxMarks } = req.body ?? {};

    if (!question || !studentAnswer || typeof maxMarks === 'undefined') {
      return res.status(400).json({
        error: 'Missing required fields: question, studentAnswer, maxMarks',
        received: { question: !!question, studentAnswer: !!studentAnswer, maxMarks: typeof maxMarks }
      });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not set');
      return res.status(500).json({ error: 'API key not configured' });
    }

    const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

    const prompt = `
You are an economics exam evaluator. Evaluate the following student answer and provide a JSON response.

**Question:** ${question}
**Model Answer:** ${modelAnswer || 'No model answer provided.'}
**Student Answer:** ${studentAnswer}
**Maximum Marks:** ${maxMarks}

Respond ONLY with a valid JSON object (no markdown, no explanations, no code fences):
{
  "score": <number between 0 and ${maxMarks}>,
  "improvements": ["<specific improvement 1>", "<specific improvement 2>", "<specific improvement 3>"],
  "feedback": "<brief overall feedback>"
}
`;

    // Call Gemini
    const apiRes = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          topK: 32,
          topP: 1,
          maxOutputTokens: 1024
        }
      })
    });

    const apiText = await apiRes.text(); // read as text first
    if (!apiRes.ok) {
      console.error('Gemini returned non-OK:', apiRes.status, apiText);
      return res.status(502).json({ error: 'Gemini API error', status: apiRes.status, body: apiText });
    }

    // Try parse JSON from the model output safely
    let data;
    try {
      data = JSON.parse(apiText);
    } catch (e) {
      // If Gemini returns structured response inside `candidates` like before, try that
      try {
        const parsed = JSON.parse(apiText);
        data = parsed;
      } catch (e2) {
        // fallback: try to extract the JSON-like payload inside text (very defensive)
        const match = apiText.match(/\{[\s\S]*\}/);
        if (match) {
          try { data = JSON.parse(match[0]); } 
          catch (_) { data = null; }
        } else {
          data = null;
        }
      }
    }

    if (!data) {
      // If no parse, return a helpful error so client can display it
      console.warn('Could not parse Gemini output:', apiText);
      return res.status(200).json({
        score: 0,
        improvements: ["Response could not be parsed as JSON.", "AI output may be incomplete or filtered."],
        feedback: "Automatic evaluation failed. Please check manually.",
        raw: apiText // useful for debugging
      });
    }

    // If the model returns nested structure, adapt accordingly:
    // (handle older shape where candidates[0].content.parts[0].text was returned)
    if (data.candidates && Array.isArray(data.candidates) && data.candidates[0]?.content) {
      const text = data.candidates[0].content.parts[0].text || "";
      try {
        const parsed = JSON.parse(text);
        data = parsed;
      } catch (err) {
        // keep original data if cannot parse
      }
    }

    // Return shape client expects
    return res.status(200).json({
      score: data.score ?? 0,
      improvements: data.improvements ?? [],
      feedback: data.feedback ?? "No feedback available.",
      rawData: data
    });

  } catch (error) {
    console.error('Evaluation handler error:', error);
    return res.status(500).json({ error: 'Evaluation failed', message: error.message });
  }
}
