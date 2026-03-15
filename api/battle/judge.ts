import { createClient } from '@supabase/supabase-js';
import { NextApiRequest, NextApiResponse } from 'next'; // or use Vercel types

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // ← IMPORTANT: service role key (full access)
);

const GROQ_API_KEY = process.env.GROQ_API_KEY!;
const XAI_API_KEY = process.env.XAI_API_KEY!;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ error: 'battleId required' });

  try {
    // 1. Get both voices
    const { data: voices } = await supabase
      .from('battle_voices')
      .select('*')
      .eq('battle_id', battleId)
      .order('created_at');

    if (!voices || voices.length !== 2) {
      return res.status(400).json({ error: 'Need exactly 2 voices to judge' });
    }

    const [voiceA, voiceB] = voices;

    // 2. Transcribe both with Groq Whisper
    const transcribe = async (url: string): Promise<string> => {
      const audioRes = await fetch(url);
      const audioBuffer = await audioRes.arrayBuffer();

      const form = new FormData();
      form.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'roast.webm');
      form.append('model', 'whisper-large-v3');
      form.append('response_format', 'json');

      const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form,
      });

      const { text } = await groqRes.json();
      return text.trim() || "No audio detected...";
    };

    const transcriptA = await transcribe(voiceA.voice_url);
    const transcriptB = await transcribe(voiceB.voice_url);

    // 3. Savage Grok Judge
    const judgePrompt = `You are the ultimate savage roast judge in VoiceRoast Arena.
Two fighters dropped 15-second voice roasts. Be brutally funny, no mercy.

Roast A (from ${voiceA.user_id}): "${transcriptA}"
Roast B (from ${voiceB.user_id}): "${transcriptB}"

Respond ONLY in this exact JSON format (no extra text):
{
  "winner_id": "the user_id of the winner",
  "roastA_text": "your savage one-liner summary of Roast A",
  "roastB_text": "your savage one-liner summary of Roast B",
  "scoreA": number 0-100,
  "scoreB": number 0-100,
  "verdict": "short hilarious final announcement like 'YOU JUST GOT COOKED 🔥' or 'THAT WAS A MIC DROP'"
}`;

    const grokRes = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [{ role: 'user', content: judgePrompt }],
        temperature: 0.9,
        max_tokens: 400,
      }),
    });

    const grokData = await grokRes.json();
    const content = grokData.choices[0].message.content;
    const result = JSON.parse(content);

    // 4. Update DB
    await supabase
      .from('battle_voices')
      .update({ roast_text: result.roastA_text, score: result.scoreA })
      .eq('id', voiceA.id);

    await supabase
      .from('battle_voices')
      .update({ roast_text: result.roastB_text, score: result.scoreB })
      .eq('id', voiceB.id);

    await supabase
      .from('battles')
      .update({
        status: 'finished',
        winner_id: result.winner_id,
      })
      .eq('id', battleId);

    // 5. Return to frontend
    return res.status(200).json({
      winner: result.winner_id,
      verdict: result.verdict,
    });

  } catch (error: any) {
    console.error('Judge error:', error);
    return res.status(500).json({ error: error.message || 'Judge failed 🔥' });
  }
}
