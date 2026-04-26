// Server-side endpoint to clone player's voice via ElevenLabs API
// Uses Vercel-compatible function signature so it works in dev and prod

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
        // Read the raw audio buffer from request
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const audioBuffer = Buffer.concat(chunks);

        // Build form-data for ElevenLabs (manually, since we have the raw bytes)
        const boundary = "----voiceprintform" + Date.now();
        const head = Buffer.from(
            `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="name"\r\n\r\n` +
                `voiceprint_player_${Date.now()}\r\n` +
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="files"; filename="sample.wav"\r\n` +
                `Content-Type: audio/wav\r\n\r\n`,
            "utf-8",
        );
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
        const body = Buffer.concat([head, audioBuffer, tail]);

        const cloneRes = await fetch(
            "https://api.elevenlabs.io/v1/voices/add",
            {
                method: "POST",
                headers: {
                    "xi-api-key": API_KEY,
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                },
                body,
            },
        );

        if (!cloneRes.ok) {
            const errText = await cloneRes.text();
            console.error("Clone failed:", cloneRes.status, errText);
            res.statusCode = cloneRes.status;
            res.end(JSON.stringify({ error: `Clone failed: ${errText}` }));
            return;
        }

        const data = await cloneRes.json();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ voice_id: data.voice_id }));
    } catch (err) {
        console.error("Server error:", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}
