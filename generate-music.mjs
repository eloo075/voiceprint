import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const API_KEY = process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY;

if (!API_KEY) {
    console.error("Missing ELEVENLABS_API_KEY in .env.local");
    process.exit(1);
}

async function generateMusic() {
    console.log("Generating cinematic horror score...");
    const res = await fetch("https://api.elevenlabs.io/v1/music/compose", {
        method: "POST",
        headers: {
            "xi-api-key": API_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            prompt: "Slow tense ambient horror score for game trailer. Low pulsing synths, distant electronic decay, sub-bass swells. Atmospheric and unsettling. No melody, no vocals. 60 seconds. 70 BPM. Dark and cinematic.",
            music_length_ms: 60000,
        }),
    });

    if (!res.ok) {
        console.error("Failed:", res.status, await res.text());
        return;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync("./video-soundtrack.mp3", buf);
    console.log(`Saved video-soundtrack.mp3 (${(buf.length / 1024).toFixed(1)} KB)`);
}

generateMusic();
