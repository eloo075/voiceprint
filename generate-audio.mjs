import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
    console.error("❌ Missing ELEVENLABS_API_KEY in .env.local");
    process.exit(1);
}

const OUTPUT_DIR = "./public/audio";
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ---------- Sound Effects ----------
const SOUND_EFFECTS = [
    {
        name: "footstep_1",
        text: "Single quiet footstep on hard concrete floor in an empty echoing hallway, dry, close mic",
        duration: 0.5,
    },
    {
        name: "footstep_2",
        text: "Single quiet footstep on hard concrete floor in an empty echoing hallway, slightly different cadence",
        duration: 0.5,
    },
    {
        name: "footstep_3",
        text: "Single quiet footstep, soft scuff on dusty concrete, indoor reverb",
        duration: 0.5,
    },
    {
        name: "footstep_4",
        text: "Single quiet footstep, leather sole on wood floor, indoor abandoned building",
        duration: 0.5,
    },
    {
        name: "ambient_drone",
        text: "Deep low frequency horror ambient drone, abandoned radio station, distant electrical hum, very subtle, no music, eerie atmosphere, looping",
        duration: 22,
    },
    {
        name: "door_creak",
        text: "Old metal door creaking slowly open, rusty hinges, indoor",
        duration: 3,
    },
    {
        name: "distant_whisper",
        text: "Faint distant whisper of a person in another room, indistinct words, eerie",
        duration: 4,
    },
    {
        name: "static_burst",
        text: "Old radio tuning to dead frequency, white noise static burst, brief",
        duration: 2,
    },
    {
        name: "monster_breath_close",
        text: "Wet ragged inhuman breathing very close to microphone, raspy, irregular, terrifying",
        duration: 4,
    },
    {
        name: "monster_breath_far",
        text: "Distant ragged breathing echoing through empty corridor, faint, ominous",
        duration: 5,
    },
    {
        name: "monster_scrape",
        text: "Long fingernails dragging slowly across metal wall, scraping, metallic, slow",
        duration: 3,
    },
    {
        name: "monster_step",
        text: "Heavy wet bare footstep on hard concrete, single step, indoor reverb, unsettling",
        duration: 0.6,
    },
    {
        name: "monster_caught_scream",
        text: "Sudden distorted demonic shriek and inhuman roar, abrupt and terrifying jumpscare",
        duration: 2,
    },
    {
        name: "heartbeat",
        text: "Slow heavy human heartbeat, deep bass thump, single beat",
        duration: 1,
    },
];

// ---------- Narrator Voice (TTS) ----------
const NARRATOR_VOICE_ID = "BQOei2tk6QCBMHQWPhbj"; // Cedric

const NARRATOR_LINES = [
    {
        name: "narrator_intro",
        text: "You shouldn't be here. The station closed eleven years ago. But the broadcasts... the broadcasts never stopped. Find the source. And whatever you do... don't speak unless you have to.",
    },
    {
        name: "narrator_mic_found",
        text: "You found the microphone. It's still warm. Someone was just here.",
    },
    {
        name: "narrator_record_request",
        text: "Wait. There's a signal coming through. Something wants to hear you. Speak. Anything. Read the line. Don't stop until it tells you to.",
    },
    {
        name: "narrator_clone_done",
        text: "It has your voice now. Listen carefully... and trust nothing you hear.",
    },
];

async function generateSoundEffect({ name, text, duration }) {
    const outPath = path.join(OUTPUT_DIR, `${name}.mp3`);
    if (fs.existsSync(outPath)) {
        console.log(`⏭  Skipping ${name} (already exists)`);
        return;
    }
    console.log(`🎵 Generating ${name}...`);
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
        console.error(`❌ ${name} failed: ${res.status} ${await res.text()}`);
        return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    console.log(`✅ Saved ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
}

async function generateTTS({ name, text }) {
    const outPath = path.join(OUTPUT_DIR, `${name}.mp3`);
    if (fs.existsSync(outPath)) {
        console.log(`⏭  Skipping ${name} (already exists)`);
        return;
    }
    console.log(`🗣  Generating ${name}...`);
    const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${NARRATOR_VOICE_ID}`,
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
                    stability: 0.4,
                    similarity_boost: 0.75,
                    style: 0.6,
                    use_speaker_boost: true,
                },
            }),
        },
    );
    if (!res.ok) {
        console.error(`❌ ${name} failed: ${res.status} ${await res.text()}`);
        return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    console.log(`✅ Saved ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
}

console.log("🎙  Generating Voiceprint audio assets...\n");
for (const sfx of SOUND_EFFECTS) await generateSoundEffect(sfx);
console.log("");
for (const line of NARRATOR_LINES) await generateTTS(line);
console.log("\n🎉 Done! Audio files in public/audio/");
