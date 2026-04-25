// Client-side voice cloning helpers

export async function recordVoiceSample(durationMs: number): Promise<Blob> {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100,
        },
    });

    return new Promise((resolve, reject) => {
        const chunks: Blob[] = [];
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm";
        const recorder = new MediaRecorder(stream, { mimeType });

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            resolve(new Blob(chunks, { type: mimeType }));
        };
        recorder.onerror = (e) => reject(e);

        recorder.start();
        setTimeout(() => recorder.stop(), durationMs);
    });
}

export async function cloneVoice(audioBlob: Blob): Promise<string> {
    const res = await fetch("/api/clone-voice", {
        method: "POST",
        headers: { "Content-Type": "audio/webm" },
        body: audioBlob,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Clone failed: ${err}`);
    }
    const data = await res.json();
    return data.voice_id;
}

export async function ttsAsPlayer(
    voiceId: string,
    text: string,
): Promise<AudioBuffer> {
    const res = await fetch("/api/tts-as-player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voiceId, text }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`TTS failed: ${err}`);
    }
    const arr = await res.arrayBuffer();
    // Decode using a fresh audio context (caller can play the buffer)
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const buffer = await ctx.decodeAudioData(arr);
    return buffer;
}

// Player whisper bank — the monster will whisper these in the player's voice
export const PLAYER_WHISPERS = [
    "I'm right behind you.",
    "Don't turn around.",
    "I can hear your heart.",
    "I'm not the only one anymore.",
    "Why did you come here?",
    "Stop running.",
    "I just want to talk.",
    "It's okay. It's just me.",
];
