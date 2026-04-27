// TTS using the player's cloned voice — used to whisper monster lines back at them
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // also load .env if exists

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
    }

    const API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!API_KEY) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "API key not configured" }));
        return;
    }

    try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const { voice_id, text } = JSON.parse(Buffer.concat(chunks).toString());

        const ttsRes = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.9,
                        style: 0.25,
                        use_speaker_boost: true,
                    },
                }),
            },
        );

        if (!ttsRes.ok) {
            const errText = await ttsRes.text();
            console.error("TTS failed:", ttsRes.status, errText);
            res.statusCode = ttsRes.status;
            res.end(JSON.stringify({ error: `TTS failed: ${errText}` }));
            return;
        }

        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        res.statusCode = 200;
        res.setHeader("Content-Type", "audio/mpeg");
        res.end(audioBuffer);
    } catch (err) {
        console.error("Server error:", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}
