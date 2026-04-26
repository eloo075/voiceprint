/**
 * Client-side voice cloning helpers.
 *
 * Important:
 * We record microphone input with Web Audio and encode it as a real mono
 * 16-bit PCM WAV file instead of relying on MediaRecorder WebM/Opus.
 * ElevenLabs voice cloning is much more reliable with WAV/MP3/M4A than
 * browser-recorded WebM.
 */

type WebkitWindow = Window &
    typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
    };

function createAudioContext(): AudioContext {
    const AudioContextCtor =
        window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    return new AudioContextCtor();
}

function downsampleBuffer(
    buffer: Float32Array,
    inputSampleRate: number,
    outputSampleRate: number,
): Float32Array {
    if (outputSampleRate === inputSampleRate) {
        return buffer;
    }

    if (outputSampleRate > inputSampleRate) {
        throw new Error(
            "Output sample rate must be lower than input sample rate",
        );
    }

    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);

    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round(
            (offsetResult + 1) * sampleRateRatio,
        );

        let accum = 0;
        let count = 0;

        for (
            let i = offsetBuffer;
            i < nextOffsetBuffer && i < buffer.length;
            i++
        ) {
            accum += buffer[i];
            count++;
        }

        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }

    return result;
}

function floatTo16BitPCM(
    output: DataView,
    offset: number,
    input: Float32Array,
): void {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(
            offset,
            sample < 0 ? sample * 0x8000 : sample * 0x7fff,
            true,
        );
    }
}

function writeString(view: DataView, offset: number, value: string): void {
    for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
    }
}

function encodeWav(
    samples: Float32Array,
    sampleRate: number,
    channels: number = 1,
): Blob {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, "WAVE");

    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);

    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);
    floatTo16BitPCM(view, 44, samples);

    return new Blob([view], { type: "audio/wav" });
}

function mergeAudioChunks(chunks: Float32Array[]): Float32Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);

    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    return merged;
}

export async function recordVoiceSample(durationMs: number): Promise<Blob> {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 44100,
        },
    });

    const ctx = createAudioContext();

    if (ctx.state === "suspended") {
        await ctx.resume();
    }

    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 1.4;

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];

    processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
    };

    source.connect(gain);
    gain.connect(processor);
    processor.connect(ctx.destination);

    return new Promise((resolve, reject) => {
        const cleanup = async () => {
            try {
                processor.disconnect();
                gain.disconnect();
                source.disconnect();
                stream.getTracks().forEach((track) => track.stop());

                if (ctx.state !== "closed") {
                    await ctx.close();
                }
            } catch (err) {
                console.warn("Recorder cleanup warning:", err);
            }
        };

        const finish = async () => {
            try {
                processor.onaudioprocess = null;

                const merged = mergeAudioChunks(chunks);
                const targetSampleRate = 44100;
                const wavSamples = downsampleBuffer(
                    merged,
                    ctx.sampleRate,
                    targetSampleRate,
                );
                const wavBlob = encodeWav(wavSamples, targetSampleRate, 1);

                await cleanup();
                resolve(wavBlob);
            } catch (err) {
                await cleanup();
                reject(err);
            }
        };

        window.setTimeout(() => {
            void finish();
        }, durationMs);
    });
}

export async function cloneVoice(audioBlob: Blob): Promise<string> {
    const res = await fetch("/api/clone-voice", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: audioBlob,
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Clone failed: ${err}`);
    }

    const data = await res.json();

    if (!data.voice_id) {
        throw new Error("Clone failed: response did not include voice_id");
    }

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
    const ctx = createAudioContext();
    const buffer = await ctx.decodeAudioData(arr);

    if (ctx.state !== "closed") {
        await ctx.close();
    }

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
