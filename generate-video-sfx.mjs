import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const API_KEY = process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY;

if (!API_KEY) {
    console.error("Missing ELEVENLABS_API_KEY in .env.local");
    process.exit(1);
}

const VIDEO_SFX = [
    {
        name: "video_riser_long",
        text: "Slow building cinematic horror riser, sub bass, tension, no impact, just rise",
        duration: 5,
    },
    {
        name: "video_impact_boom",
        text: "Deep cinematic boom impact with reverb tail, single hit, trailer style",
        duration: 3,
    },
    {
        name: "video_glitch_transition",
        text: "Digital glitch transition sound, brief, electronic, sharp",
        duration: 1,
    },
    {
        name: "video_whoosh_dark",
        text: "Dark cinematic whoosh transition, low pass, ominous, brief",
        duration: 1.5,
    },
];

async function gen({ name, text, duration }) {
    const out = `./video-sfx/${name}.mp3`;
    if (fs.existsSync(out)) {
        console.log(`Skipping ${name}`);
        return;
    }

    console.log(`Generating ${name}...`);
    const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
        method: "POST",
        headers: {
            "xi-api-key": API_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text,
            duration_seconds: duration,
            prompt_influence: 0.6,
        }),
    });

    if (!res.ok) {
        console.error("Failed:", await res.text());
        return;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(out, buf);
    console.log(`Saved ${(buf.length / 1024).toFixed(1)} KB`);
}

fs.mkdirSync("./video-sfx", { recursive: true });
console.log("Generating video SFX...\n");
for (const sfx of VIDEO_SFX) await gen(sfx);
console.log("\nDone! Files in ./video-sfx/");
