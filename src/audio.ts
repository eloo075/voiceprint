// Centralized audio system for Voiceprint

type SfxName =
    | "footstep_1"
    | "footstep_2"
    | "footstep_3"
    | "footstep_4"
    | "ambient_drone"
    | "door_creak"
    | "distant_whisper"
    | "static_burst"
    | "narrator_intro"
    | "narrator_mic_found"
    | "narrator_record_request"
    | "narrator_clone_done"
    | "monster_breath_close"
    | "monster_breath_far"
    | "monster_scrape"
    | "monster_step"
    | "monster_caught_scream"
    | "heartbeat";

const buffers: Map<SfxName, AudioBuffer> = new Map();
let ctx: AudioContext | null = null;
let ambientGain: GainNode | null = null;
let initialized = false;

export function getCtx(): AudioContext {
    if (!ctx) {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return ctx;
}

export async function loadAllSounds(
    onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
    const ac = getCtx();
    const names: SfxName[] = [
        "footstep_1",
        "footstep_2",
        "footstep_3",
        "footstep_4",
        "ambient_drone",
        "door_creak",
        "distant_whisper",
        "static_burst",
        "narrator_intro",
        "narrator_mic_found",
        "narrator_record_request",
        "narrator_clone_done",
        "monster_breath_close",
        "monster_breath_far",
        "monster_scrape",
        "monster_step",
        "monster_caught_scream",
        "heartbeat",
    ];

    let loaded = 0;
    await Promise.all(
        names.map(async (name) => {
            try {
                const res = await fetch(`/audio/${name}.mp3`);
                const arr = await res.arrayBuffer();
                const buf = await ac.decodeAudioData(arr);
                buffers.set(name, buf);
                loaded++;
                onProgress?.(loaded, names.length);
            } catch (err) {
                console.error(`Failed to load ${name}:`, err);
            }
        }),
    );
    initialized = true;
}

export function isReady(): boolean {
    return initialized;
}

export function playOneShot(
    name: SfxName,
    volume: number = 1,
    playbackRate: number = 1,
): void {
    const buf = buffers.get(name);
    if (!buf) return;
    const ac = getCtx();
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;
    const g = ac.createGain();
    g.gain.value = volume;
    src.connect(g).connect(ac.destination);
    src.start(0);
}

export function playRandomFootstep(volume: number = 0.4): void {
    const choice = Math.floor(Math.random() * 4) + 1;
    playOneShot(
        `footstep_${choice}` as SfxName,
        volume,
        0.95 + Math.random() * 0.1,
    );
}

let ambientSource: AudioBufferSourceNode | null = null;

export function startAmbient(volume: number = 0.35): void {
    const buf = buffers.get("ambient_drone");
    if (!buf) return;
    if (ambientSource) return; // already playing
    const ac = getCtx();
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ac.createGain();
    g.gain.value = volume;
    ambientGain = g;
    src.connect(g).connect(ac.destination);
    src.start(0);
    ambientSource = src;
}

export function setAmbientVolume(volume: number): void {
    if (ambientGain) ambientGain.gain.value = volume;
}

// Returns a promise that resolves when the narrator line finishes
export function playNarrator(
    name:
        | "narrator_intro"
        | "narrator_mic_found"
        | "narrator_record_request"
        | "narrator_clone_done",
    volume: number = 1,
): Promise<void> {
    return new Promise((resolve) => {
        const buf = buffers.get(name);
        if (!buf) {
            resolve();
            return;
        }
        const ac = getCtx();
        const src = ac.createBufferSource();
        src.buffer = buf;
        const g = ac.createGain();
        g.gain.value = volume;
        src.connect(g).connect(ac.destination);
        src.start(0);
        src.onended = () => resolve();
    });
}

// Subtitle helper
const subtitleEl = () => document.getElementById("narrator-subtitle");

export function showSubtitle(text: string, durationMs: number): void {
    const el = subtitleEl();
    if (!el) return;
    el.textContent = text;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), durationMs);
}

// 3D positional audio for the monster (using stereo panning + distance attenuation)
let monsterBreathSource: AudioBufferSourceNode | null = null;
let monsterBreathGain: GainNode | null = null;
let monsterBreathPanner: StereoPannerNode | null = null;

export function startMonsterBreath(): void {
    const buf = buffers.get("monster_breath_far");
    if (!buf) return;
    if (monsterBreathSource) return;
    const ac = getCtx();
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ac.createGain();
    g.gain.value = 0;
    const p = ac.createStereoPanner();
    src.connect(g).connect(p).connect(ac.destination);
    src.start(0);
    monsterBreathSource = src;
    monsterBreathGain = g;
    monsterBreathPanner = p;
}

// Distance: 0 = right next to you, 1 = far away
// Pan: -1 left, 0 center, 1 right
export function updateMonsterBreath(distance: number, pan: number): void {
    if (!monsterBreathGain || !monsterBreathPanner) return;
    // Volume curve: very loud when close, silent when far
    const volume = Math.max(0, Math.min(0.85, (1 - distance) * 0.85));
    monsterBreathGain.gain.value = volume;
    monsterBreathPanner.pan.value = Math.max(-1, Math.min(1, pan));
}

let heartbeatActive = false;
let heartbeatTimer: number | null = null;

// Play a raw AudioBuffer (e.g. cloned voice TTS) with 3D positioning
export function playBufferAsMonsterWhisper(
    buf: AudioBuffer,
    distance: number,
    pan: number,
): void {
    const ac = getCtx();
    const src = ac.createBufferSource();
    src.buffer = buf;
    // Slightly slow it down for unsettling effect
    src.playbackRate.value = 0.92;
    const g = ac.createGain();
    // Louder than before — and a floor of 0.55 so it's always audible
    g.gain.value = Math.max(0.55, Math.min(1.1, (1 - distance * 0.4) * 1.0));
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    // Less aggressive low-pass so the voice is more recognizable
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3500;
    // Slight reverb-ish wet sound using a delay tap
    const delay = ac.createDelay(0.15);
    delay.delayTime.value = 0.08;
    const wetGain = ac.createGain();
    wetGain.gain.value = 0.35;
    src.connect(filter);
    filter.connect(g);
    filter.connect(delay);
    delay.connect(wetGain);
    wetGain.connect(g);
    g.connect(p).connect(ac.destination);
    src.start(0);
}

export function setHeartbeatRate(bpm: number): void {
    // 0 = stop, 60 = calm, 140 = panic
    if (bpm <= 0) {
        if (heartbeatTimer !== null) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        heartbeatActive = false;
        return;
    }
    if (heartbeatActive && heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
    }
    heartbeatActive = true;
    const interval = 60000 / bpm;
    heartbeatTimer = window.setInterval(() => {
        playOneShot("heartbeat", 0.5);
    }, interval);
}
