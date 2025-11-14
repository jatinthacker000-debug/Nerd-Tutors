// client-side gemini-config.js (changed error handling)
export async function evaluateWithGemini({ question, modelAnswer, studentAnswer, maxMarks }) {
  try {
    const response = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, modelAnswer: modelAnswer || '', studentAnswer, maxMarks })
    });

    // Read text always, then try parse
    const text = await response.text();

    // If non-ok, include body in thrown error for debugging
    if (!response.ok) {
      console.error('Backend error text:', text);
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
      throw new Error(parsed?.error || parsed?.message || `Backend error: ${response.status}`);
    }

    // Try to parse JSON result
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      console.warn('Could not parse JSON from backend:', text);
      // fallback: return a structured failure so UI still works
      return {
        score: 0,
        improvements: ["Response could not be parsed as JSON.", "See console/raw response for details."],
        feedback: "Evaluation failed to parse backend response."
      };
    }

    return {
      score: result.score ?? 0,
      improvements: result.improvements ?? [],
      feedback: result.feedback ?? "No feedback available."
    };

  } catch (error) {
    console.error('❌ Gemini evaluation error:', error);
    return {
      score: 0,
      improvements: [
        "Unable to evaluate due to processing error.",
        "Possible issue: network, quota, or API filter.",
        "Marked for manual review."
      ],
      feedback: `Evaluation failed: ${error.message}`
    };
  }
}
