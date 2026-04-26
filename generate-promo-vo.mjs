import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
    console.error("Missing ELEVENLABS_API_KEY in .env.local");
    process.exit(1);
}

const VOICE_ID = "nPczCjzI2devNBz1zQrb"; // Brian -- confident, direct American male

const PROMO_LINES = [
    {
        name: "promo_01_hook",
        text: "I built a horror game that clones your voice. And then uses it against you.",
    },
    {
        name: "promo_02_setup",
        text: "It's called Voiceprint. You're alone in an abandoned radio station. The broadcasts stopped eleven years ago. But something is still on the air.",
    },
    {
        name: "promo_03_mechanic",
        text: "Halfway through, the game asks you to speak into your microphone. Just for a second. Just one line.",
    },
    {
        name: "promo_04_clone",
        text: "Behind the scenes, ElevenLabs clones your voice in real time.",
    },
    {
        name: "promo_05_payoff",
        text: "Then... the monster starts whispering. In your voice.",
    },
    {
        name: "promo_06_tech",
        text: "Built in four days with Zed and ElevenLabs. Three.js for the world. Web Audio for the soundscape. ElevenLabs for everything you hear.",
    },
    {
        name: "promo_07_outro",
        text: "Play it free. Link in the bio. Hashtag ElevenHacks.",
    },
];

const OUTPUT_DIR = "./public/promo-vo";
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function generate({ name, text }) {
    const outPath = `${OUTPUT_DIR}/${name}.mp3`;
    if (fs.existsSync(outPath)) {
        console.log("Skipping " + name);
        return;
    }
    console.log(name + ': "' + text.slice(0, 60) + '..."');
    const res = await fetch(
        "https://api.elevenlabs.io/v1/text-to-speech/" + VOICE_ID,
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
                    similarity_boost: 0.8,
                    style: 0.3,
                    use_speaker_boost: true,
                },
            }),
        },
    );
    if (!res.ok) {
        console.error(name + " failed: " + (await res.text()));
        return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    console.log(
        "Saved " + (buf.length / 1024).toFixed(1) + " KB -> " + outPath,
    );
}

console.log("Generating Voiceprint promo VO...\n");
for (const line of PROMO_LINES) await generate(line);
console.log("\nDone! VO files in public/promo-vo/");
