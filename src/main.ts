import * as THREE from "three";
import { EffectComposer } from "three-stdlib";
import { RenderPass } from "three-stdlib";
import { UnrealBloomPass } from "three-stdlib";
import { ShaderPass } from "three-stdlib";
import "./style.css";
import {
    loadAllSounds,
    playNarrator,
    playRandomFootstep,
    startAmbient,
    playOneShot,
    showSubtitle,
    startMonsterBreath,
    updateMonsterBreath,
    setHeartbeatRate,
    playBufferAsMonsterWhisper,
} from "./audio";
import {
    recordVoiceSample,
    cloneVoice,
    ttsAsPlayer,
    PLAYER_WHISPERS,
} from "./voiceClone";

function init() {
    // ============ SCENE SETUP ============
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.016);

    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        100,
    );
    camera.position.set(0, 1.7, 0);

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
        stencil: false,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    const quality = new URLSearchParams(window.location.search).get("quality");
    const pixelRatioCap =
        quality === "ultra" ? 3 : quality === "high" ? 2.5 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    // ============ POST-PROCESSING PIPELINE ============
    const composer = new EffectComposer(renderer);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Bloom — makes lights glow cinematically
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.7,
        0.6,
        0.25,
    );
    composer.addPass(bloomPass);

    // Color grading + film effects shader
    const cinematicShader = {
        uniforms: {
            tDiffuse: { value: null },
            uTime: { value: 0 },
            uVignette: { value: 0.85 },
            uChromatic: { value: 0.002 },
            uGrain: { value: 0.045 },
            uContrast: { value: 1.08 },
            uSaturation: { value: 0.95 },
            uTint: { value: new THREE.Vector3(1.0, 0.96, 0.92) },
            uBloodSplat: { value: 0.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float uTime;
            uniform float uVignette;
            uniform float uChromatic;
            uniform float uGrain;
            uniform float uContrast;
            uniform float uSaturation;
            uniform vec3 uTint;
            uniform float uBloodSplat;
            varying vec2 vUv;

            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
            }

            void main() {
                vec2 uv = vUv;
                vec2 center = vec2(0.5);
                vec2 fromCenter = uv - center;

                // Chromatic aberration — split color channels toward the edges.
                vec3 col;
                col.r = texture2D(tDiffuse, uv + fromCenter * uChromatic).r;
                col.g = texture2D(tDiffuse, uv).g;
                col.b = texture2D(tDiffuse, uv - fromCenter * uChromatic).b;

                // Warm cinematic color grade.
                col *= uTint;

                // Contrast.
                col = (col - 0.5) * uContrast + 0.5;

                // Saturation.
                float gray = dot(col, vec3(0.299, 0.587, 0.114));
                col = mix(vec3(gray), col, uSaturation);

                // Film grain.
                float grain = random(uv * (uTime * 0.001 + 17.0)) - 0.5;
                col += grain * uGrain;

                // Vignette.
                float dist = length(fromCenter);
                float vig = 1.0 - dist * uVignette;
                vig = clamp(vig, 0.0, 1.0);
                col *= vig;

                // Blood splatter / red edge pressure when monster is close.
                if (uBloodSplat > 0.0) {
                    float n = random(uv * 42.0);
                    float splat = smoothstep(1.0 - uBloodSplat * 0.4, 1.0, n);
                    col = mix(col, vec3(0.5, 0.0, 0.0), splat * uBloodSplat);
                    col.r += dist * uBloodSplat * 0.6;
                }

                gl_FragColor = vec4(col, 1.0);
            }
        `,
    };

    const cinematicPass = new ShaderPass(cinematicShader);
    composer.addPass(cinematicPass);

    // ============ TEXTURE GENERATORS ============
    function makeNoiseTexture(
        w: number,
        h: number,
        baseColor: [number, number, number],
        variation: number,
    ): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        const img = ctx.createImageData(w, h);
        for (let i = 0; i < img.data.length; i += 4) {
            const noise = (Math.random() - 0.5) * variation;
            img.data[i] = Math.max(0, Math.min(255, baseColor[0] + noise));
            img.data[i + 1] = Math.max(0, Math.min(255, baseColor[1] + noise));
            img.data[i + 2] = Math.max(0, Math.min(255, baseColor[2] + noise));
            img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        for (let p = 0; p < 12; p++) {
            const x = Math.random() * w;
            const y = Math.random() * h;
            const r = 20 + Math.random() * 60;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, `rgba(0,0,0,${0.15 + Math.random() * 0.2})`);
            grad.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    function makeWoodTexture(w: number, h: number): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#3a2820";
        ctx.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 64) {
            ctx.fillStyle = `rgba(0,0,0,0.4)`;
            ctx.fillRect(0, y, w, 1);
            ctx.fillStyle = `rgba(${20 + Math.random() * 30},${10 + Math.random() * 20},${5 + Math.random() * 15},0.3)`;
            ctx.fillRect(0, y + 1, w, 63);
        }
        for (let i = 0; i < 200; i++) {
            ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
            ctx.fillRect(
                Math.random() * w,
                Math.random() * h,
                1 + Math.random() * 60,
                1,
            );
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    function applyAging(ctx: CanvasRenderingContext2D, w: number, h: number) {
        for (let p = 0; p < 30; p++) {
            const x = Math.random() * w;
            const y = Math.random() * h;
            const r = 5 + Math.random() * 40;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, `rgba(40,30,20,${0.1 + Math.random() * 0.3})`);
            grad.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
        }
        for (let i = 0; i < 20; i++) {
            ctx.strokeStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.random() * w, Math.random() * h);
            ctx.lineTo(Math.random() * w, Math.random() * h);
            ctx.stroke();
        }
    }

    // ============ POSTERS ============
    function makePosterTexture(
        type: "onair" | "missing" | "logo" | "warning" | "schedule",
    ): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 768;
        const ctx = canvas.getContext("2d")!;

        if (type === "onair") {
            ctx.fillStyle = "#1a0808";
            ctx.fillRect(0, 0, 512, 768);
            ctx.fillStyle = "#aa1a1a";
            ctx.fillRect(40, 280, 432, 200);
            ctx.fillStyle = "#ff3030";
            ctx.font = "bold 130px Arial Black";
            ctx.textAlign = "center";
            ctx.fillText("ON AIR", 256, 410);
            ctx.fillStyle = "#666";
            ctx.font = "20px monospace";
            ctx.fillText("WBRJ 99.7 FM", 256, 540);
        } else if (type === "missing") {
            ctx.fillStyle = "#ddd2b8";
            ctx.fillRect(0, 0, 512, 768);
            ctx.fillStyle = "#000";
            ctx.font = "bold 80px Arial";
            ctx.textAlign = "center";
            ctx.fillText("MISSING", 256, 90);
            ctx.fillStyle = "#888";
            ctx.fillRect(106, 130, 300, 350);
            ctx.fillStyle = "#444";
            ctx.beginPath();
            ctx.arc(256, 260, 60, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(166, 340, 180, 140);
            ctx.fillStyle = "#000";
            ctx.font = "bold 36px Arial";
            ctx.fillText("MARCUS REED", 256, 540);
            ctx.font = "22px Arial";
            ctx.fillText("Last seen at WBRJ", 256, 580);
            ctx.fillText("November 14, 2014", 256, 612);
            ctx.font = "18px Arial";
            ctx.fillText("If found, please call", 256, 670);
            ctx.fillText("(555) 0199-2847", 256, 696);
        } else if (type === "logo") {
            ctx.fillStyle = "#1a1812";
            ctx.fillRect(0, 0, 512, 768);
            ctx.strokeStyle = "#c9a44c";
            ctx.lineWidth = 8;
            ctx.strokeRect(30, 30, 452, 708);
            ctx.fillStyle = "#c9a44c";
            ctx.font = "bold 100px Georgia";
            ctx.textAlign = "center";
            ctx.fillText("WBRJ", 256, 280);
            ctx.font = "32px Georgia";
            ctx.fillText("99.7 FM", 256, 340);
            ctx.font = "italic 24px Georgia";
            ctx.fillText("The Voice of the Valley", 256, 400);
            ctx.font = "20px Georgia";
            ctx.fillText("Est. 1987", 256, 600);
            ctx.strokeStyle = "#c9a44c";
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let x = 80; x < 432; x += 4) {
                const y = 480 + Math.sin(x * 0.05) * 20;
                if (x === 80) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        } else if (type === "warning") {
            ctx.fillStyle = "#222";
            ctx.fillRect(0, 0, 512, 768);
            ctx.fillStyle = "#ffaa00";
            ctx.fillRect(40, 40, 432, 688);
            ctx.fillStyle = "#222";
            ctx.beginPath();
            ctx.moveTo(256, 130);
            ctx.lineTo(420, 380);
            ctx.lineTo(92, 380);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#ffaa00";
            ctx.font = "bold 200px Arial Black";
            ctx.textAlign = "center";
            ctx.fillText("!", 256, 360);
            ctx.fillStyle = "#222";
            ctx.font = "bold 50px Arial";
            ctx.fillText("RESTRICTED", 256, 480);
            ctx.font = "bold 38px Arial";
            ctx.fillText("AUTHORIZED", 256, 560);
            ctx.fillText("PERSONNEL ONLY", 256, 605);
            ctx.font = "20px Arial";
            ctx.fillText("VIOLATORS WILL BE PROSECUTED", 256, 680);
        } else if (type === "schedule") {
            ctx.fillStyle = "#f4ecd6";
            ctx.fillRect(0, 0, 512, 768);
            ctx.fillStyle = "#000";
            ctx.font = "bold 36px Arial";
            ctx.textAlign = "center";
            ctx.fillText("BROADCAST SCHEDULE", 256, 60);
            ctx.font = "20px monospace";
            ctx.textAlign = "left";
            const shows = [
                ["06:00", "Morning Wake-Up - Diane"],
                ["09:00", "Local News & Weather"],
                ["10:00", "Music Hour - Carl"],
                ["12:00", "Midday Talk"],
                ["14:00", "Afternoon Drive - Reed"],
                ["17:00", "Evening News"],
                ["18:00", "Soft Jazz - Marlene"],
                ["21:00", "The Late Show - ???"],
                ["00:00", "[REDACTED]"],
                ["03:00", "[REDACTED]"],
            ];
            shows.forEach(([time, show], i) => {
                const y = 130 + i * 50;
                ctx.fillStyle = i >= 8 ? "#aa0000" : "#000";
                ctx.fillText(time, 60, y);
                ctx.fillText(show, 180, y);
            });
        }
        applyAging(ctx, 512, 768);
        return new THREE.CanvasTexture(canvas);
    }

    // ============ BRAND POSTERS (Zed + ElevenLabs) ============
    function makeBrandPoster(
        type: "zed" | "elevenlabs" | "zed_defaced" | "elevenlabs_defaced",
    ): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 768;
        const ctx = canvas.getContext("2d")!;

        if (type === "zed" || type === "zed_defaced") {
            // Aged paper background
            ctx.fillStyle = "#0a0a0a";
            ctx.fillRect(0, 0, 512, 768);
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(20, 20, 472, 728);
            // Zed Z logo (geometric Z made of nested squares)
            ctx.strokeStyle = "#e8e8e8";
            ctx.lineWidth = 6;
            const cx = 256,
                cy = 320;
            // Draw a stylized Z based on the Zed logo (nested square with diagonal)
            ctx.save();
            ctx.translate(cx, cy);
            // Outer square frame (rotated slightly for that Z look)
            ctx.rotate(-0.05);
            ctx.strokeRect(-100, -100, 200, 200);
            ctx.strokeRect(-80, -80, 160, 160);
            ctx.strokeRect(-60, -60, 120, 120);
            // The diagonal Z slash
            ctx.beginPath();
            ctx.moveTo(-110, -110);
            ctx.lineTo(110, 110);
            ctx.lineWidth = 8;
            ctx.stroke();
            ctx.restore();
            // Text
            ctx.fillStyle = "#e8e8e8";
            ctx.font = "bold 56px Arial";
            ctx.textAlign = "center";
            ctx.fillText("POWERED BY", 256, 510);
            ctx.font = "bold 96px Arial";
            ctx.fillText("ZED", 256, 605);
            ctx.font = "18px monospace";
            ctx.fillStyle = "#888";
            ctx.fillText("BROADCAST SYSTEMS · EST. 1987", 256, 660);
            ctx.fillText("LICENSE #ZED-87-WBRJ-0042", 256, 690);

            if (type === "zed_defaced") {
                // Spray paint X over it
                ctx.strokeStyle = "rgba(180, 0, 0, 0.85)";
                ctx.lineWidth = 14;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(80, 100);
                ctx.lineTo(440, 660);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(440, 100);
                ctx.lineTo(80, 660);
                ctx.stroke();
                // Drips
                ctx.fillStyle = "rgba(140, 0, 0, 0.7)";
                for (let i = 0; i < 8; i++) {
                    const x = 80 + Math.random() * 360;
                    ctx.fillRect(
                        x,
                        100 + Math.random() * 560,
                        4,
                        30 + Math.random() * 60,
                    );
                }
            }
        } else if (type === "elevenlabs" || type === "elevenlabs_defaced") {
            // Cream background — looks like old equipment certification
            ctx.fillStyle = "#1a1610";
            ctx.fillRect(0, 0, 512, 768);
            ctx.fillStyle = "#e8dfc4";
            ctx.fillRect(30, 30, 452, 708);
            // Border
            ctx.strokeStyle = "#3a3328";
            ctx.lineWidth = 4;
            ctx.strokeRect(50, 50, 412, 668);
            ctx.lineWidth = 2;
            ctx.strokeRect(60, 60, 392, 648);
            // Two vertical bars (the eleven labs "II" logo)
            ctx.fillStyle = "#1a1410";
            ctx.fillRect(170, 200, 28, 200);
            ctx.fillRect(220, 200, 28, 200);
            // "Eleven Labs" text
            ctx.fillStyle = "#1a1410";
            ctx.font = "bold 64px Arial";
            ctx.textAlign = "left";
            ctx.fillText("Eleven", 270, 290);
            ctx.fillText("Labs", 270, 360);
            // Certification text
            ctx.font = "bold 32px Georgia";
            ctx.textAlign = "center";
            ctx.fillStyle = "#3a3328";
            ctx.fillText("AUDIO CERTIFIED", 256, 480);
            ctx.font = "italic 20px Georgia";
            ctx.fillText("Broadcast Voice Systems", 256, 520);
            ctx.font = "16px monospace";
            ctx.fillText("MODEL: 11L-BX-2014", 256, 590);
            ctx.fillText("CERT #11.11.2014", 256, 615);
            ctx.fillText("APPROVED FOR FCC BROADCAST", 256, 640);
            // Circular seal
            ctx.strokeStyle = "#7a3a1a";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(420, 670, 30, 0, Math.PI * 2);
            ctx.stroke();
            ctx.font = "10px Arial";
            ctx.fillStyle = "#7a3a1a";
            ctx.fillText("CERTIFIED", 420, 668);
            ctx.fillText("11LABS", 420, 680);

            if (type === "elevenlabs_defaced") {
                // Scratched out with knife marks
                ctx.strokeStyle = "rgba(80, 0, 0, 0.8)";
                ctx.lineWidth = 5;
                for (let i = 0; i < 6; i++) {
                    ctx.beginPath();
                    ctx.moveTo(
                        80 + Math.random() * 350,
                        100 + Math.random() * 550,
                    );
                    ctx.lineTo(
                        80 + Math.random() * 350,
                        100 + Math.random() * 550,
                    );
                    ctx.stroke();
                }
                // Scrawled "11:11" in red over the cert
                ctx.fillStyle = "rgba(140, 0, 0, 0.9)";
                ctx.font = "bold 90px 'Courier New'";
                ctx.textAlign = "center";
                ctx.save();
                ctx.translate(256, 384);
                ctx.rotate(-0.15);
                ctx.fillText("11:11", 0, 0);
                ctx.restore();
            }
        }
        applyAging(ctx, 512, 768);
        return new THREE.CanvasTexture(canvas);
    }

    // ============ GRAFFITI (transparent decals) ============
    function makeGraffiti(
        text: string,
        color: string = "#aa0000",
    ): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        // Wider canvas, more padding around text
        canvas.width = 1024;
        canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, 1024, 256);

        // Slight rotation
        ctx.save();
        ctx.translate(512, 130);
        ctx.rotate((Math.random() - 0.5) * 0.08);

        // Outer glow
        ctx.shadowColor = color;
        ctx.shadowBlur = 25;
        ctx.fillStyle = color;
        ctx.font = "bold 110px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 0, 0);

        // Hard inner stroke
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(60, 0, 0, 0.6)";
        ctx.lineWidth = 2;
        ctx.strokeText(text, 0, 0);

        ctx.restore();

        // Spray paint drips beneath the text
        const dripStartY = 200;
        for (let i = 0; i < 14; i++) {
            const x = 200 + Math.random() * 624;
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.35 + Math.random() * 0.45;
            ctx.fillRect(
                x,
                dripStartY,
                2 + Math.random() * 2,
                10 + Math.random() * 35,
            );
        }
        // Spray paint flecks
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 60; i++) {
            ctx.fillStyle = color;
            ctx.fillRect(
                150 + Math.random() * 720,
                50 + Math.random() * 200,
                1,
                1,
            );
        }
        ctx.globalAlpha = 1;
        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    }

    // ============ BLOODY HANDPRINT ============
    function makeBloodHand(): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, 256, 256);
        // Palm
        ctx.fillStyle = "rgba(120, 10, 10, 0.85)";
        ctx.beginPath();
        ctx.ellipse(128, 160, 50, 60, 0, 0, Math.PI * 2);
        ctx.fill();
        // Fingers (5 of them)
        const fingerData = [
            { x: 70, y: 90, w: 18, h: 60, rot: -0.3 }, // thumb
            { x: 100, y: 60, w: 16, h: 75, rot: -0.1 }, // index
            { x: 128, y: 50, w: 16, h: 85, rot: 0 }, // middle
            { x: 156, y: 60, w: 16, h: 75, rot: 0.1 }, // ring
            { x: 184, y: 80, w: 15, h: 60, rot: 0.25 }, // pinky
        ];
        fingerData.forEach((f) => {
            ctx.save();
            ctx.translate(f.x, f.y + f.h / 2);
            ctx.rotate(f.rot);
            ctx.fillStyle = "rgba(120, 10, 10, 0.85)";
            ctx.beginPath();
            ctx.ellipse(0, 0, f.w, f.h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        // Smear/drips going down
        for (let i = 0; i < 8; i++) {
            ctx.fillStyle = `rgba(${100 + Math.random() * 40},${5 + Math.random() * 15},${5 + Math.random() * 10},${0.4 + Math.random() * 0.4})`;
            const x = 90 + Math.random() * 80;
            ctx.fillRect(
                x,
                200,
                3 + Math.random() * 5,
                20 + Math.random() * 60,
            );
        }
        // Texture variation in handprint
        for (let i = 0; i < 100; i++) {
            ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`;
            ctx.fillRect(
                60 + Math.random() * 130,
                50 + Math.random() * 180,
                2,
                2,
            );
        }
        return new THREE.CanvasTexture(canvas);
    }

    // ============ TEXTURES ============
    const wallTex = makeNoiseTexture(512, 512, [60, 58, 55], 30);
    wallTex.repeat.set(2, 1);
    const floorTex = makeWoodTexture(1024, 1024);
    floorTex.repeat.set(8, 8);
    const ceilingTex = makeNoiseTexture(512, 512, [25, 25, 22], 15);
    ceilingTex.repeat.set(4, 4);

    // ============ LIGHTING ============
    const ambient = new THREE.AmbientLight(0x76708f, 2.15);
    scene.add(ambient);

    const flashlight = new THREE.SpotLight(
        0xfff0d0,
        6.2,
        24,
        Math.PI / 6.5,
        0.5,
        1.5,
    );
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.width = 2048;
    flashlight.shadow.mapSize.height = 2048;
    flashlight.shadow.bias = -0.0005;
    flashlight.shadow.normalBias = 0.02;
    flashlight.shadow.radius = 4;
    camera.add(flashlight);
    camera.add(flashlight.target);
    flashlight.target.position.set(0, 0, -1);

    // ============ VOLUMETRIC FLASHLIGHT BEAM ============
    // A semi-transparent cone that simulates light cutting through dust.
    const beamGeometry = new THREE.ConeGeometry(2.5, 14, 32, 1, true);
    beamGeometry.translate(0, -7, 0);
    beamGeometry.rotateX(-Math.PI / 2);

    const beamMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uOpacity: { value: 0.24 },
            uColor: { value: new THREE.Color(0xfff0d0) },
        },
        vertexShader: `
            varying vec3 vPosition;
            varying vec3 vNormal;

            void main() {
                vPosition = position;
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            uniform vec3 uColor;
            varying vec3 vPosition;
            varying vec3 vNormal;

            void main() {
                float radialDist = length(vPosition.xy);
                float radialFade = 1.0 - smoothstep(0.0, 2.5, radialDist);
                float forwardFade = smoothstep(0.0, 2.0, -vPosition.z);
                float edgeSoftness = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
                float alpha = uOpacity * radialFade * forwardFade * (1.0 - edgeSoftness * 0.5);

                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });

    const flashlightBeam = new THREE.Mesh(beamGeometry, beamMaterial);
    flashlightBeam.position.set(0, 0, 0);
    camera.add(flashlightBeam);

    scene.add(camera);

    const emergency = new THREE.PointLight(0xff2030, 0.6, 10);
    emergency.position.set(0, 2.5, -8);
    scene.add(emergency);

    const brokenLight = new THREE.PointLight(0x90b070, 0.3, 6);
    brokenLight.position.set(8, 2.7, 8);
    scene.add(brokenLight);

    // Warm amber desk lamp glow at the mixing desk
    const deskLamp = new THREE.PointLight(0xffaa55, 2.4, 7);
    deskLamp.position.set(-10, 1.8, -10);
    scene.add(deskLamp);

    // Cold barely-working fluorescent strip — east corridor
    const coldStrip = new THREE.PointLight(0x8899ff, 0.22, 9);
    coldStrip.position.set(6, 2.8, -3);
    scene.add(coldStrip);

    // Faint amber near south wall — unknown source
    const southAmber = new THREE.PointLight(0xffaa40, 0.14, 6);
    southAmber.position.set(-4, 2.5, 12);
    scene.add(southAmber);

    // ============ MATERIALS ============
    const wallMat = new THREE.MeshStandardMaterial({
        map: wallTex,
        color: 0xffffff,
        roughness: 0.95,
    });
    const floorMat = new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.85,
    });
    const ceilingMat = new THREE.MeshStandardMaterial({
        map: ceilingTex,
        roughness: 1,
    });

    // ============ ROOM ============
    const ROOM_W = 30,
        ROOM_D = 30,
        ROOM_H = 3;

    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ROOM_W, ROOM_D),
        floorMat,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const ceiling = new THREE.Mesh(
        new THREE.PlaneGeometry(ROOM_W, ROOM_D),
        ceilingMat,
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ROOM_H;
    scene.add(ceiling);

    const walls: THREE.Mesh[] = [];
    function addWall(x: number, z: number, w: number, d: number) {
        const wall = new THREE.Mesh(
            new THREE.BoxGeometry(w, ROOM_H, d),
            wallMat,
        );
        wall.position.set(x, ROOM_H / 2, z);
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add(wall);
        walls.push(wall);
    }
    addWall(0, -ROOM_D / 2, ROOM_W, 0.3);
    addWall(0, ROOM_D / 2, ROOM_W, 0.3);
    addWall(-ROOM_W / 2, 0, 0.3, ROOM_D);
    addWall(ROOM_W / 2, 0, 0.3, ROOM_D);
    addWall(-5, -5, 10, 0.3);
    addWall(5, 5, 10, 0.3);
    addWall(-8, 3, 0.3, 6);
    addWall(8, -3, 0.3, 6);

    // ============ CEILING LIGHT FIXTURES ============
    const ceilingLights: THREE.PointLight[] = [];
    function addCeilingFixture(x: number, z: number): THREE.PointLight {
        const housing = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.07, 0.22),
            new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 }),
        );
        housing.position.set(x, ROOM_H - 0.035, z);
        scene.add(housing);
        const tube = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 0.02, 0.15),
            new THREE.MeshBasicMaterial({ color: 0xc8d8ff }),
        );
        tube.position.set(x, ROOM_H - 0.07, z);
        scene.add(tube);
        const pl = new THREE.PointLight(0xc8d8ff, 0.5, 8);
        pl.position.set(x, ROOM_H - 0.12, z);
        scene.add(pl);
        return pl;
    }
    ceilingLights.push(addCeilingFixture(-5, -8)); // near desk area
    ceilingLights.push(addCeilingFixture(3, 2)); // center-right
    ceilingLights.push(addCeilingFixture(-2, 7)); // south half
    ceilingLights.push(addCeilingFixture(8, -5)); // east side

    // ============ POSTERS ============
    function addPoster(
        tex: THREE.CanvasTexture,
        x: number,
        y: number,
        z: number,
        ry: number,
        w: number,
        h: number,
    ) {
        const mat = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.9,
            side: THREE.DoubleSide,
        });
        const poster = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        poster.position.set(x, y, z);
        poster.rotation.y = ry;
        scene.add(poster);
    }

    // Story posters
    addPoster(
        makePosterTexture("logo"),
        -14.8,
        1.8,
        -10,
        Math.PI / 2,
        1.04,
        1.56,
    );
    addPoster(makePosterTexture("onair"), -10, 2.2, -14.8, 0, 0.8, 1.2);
    addPoster(
        makePosterTexture("missing"),
        -14.8,
        1.7,
        5,
        Math.PI / 2,
        0.72,
        1.08,
    );
    addPoster(
        makePosterTexture("warning"),
        14.8,
        1.8,
        -5,
        -Math.PI / 2,
        0.8,
        1.2,
    );
    addPoster(makePosterTexture("schedule"), 0, 1.9, 14.8, Math.PI, 0.88, 1.32);
    addPoster(
        makePosterTexture("missing"),
        14.8,
        1.6,
        8,
        -Math.PI / 2,
        0.68,
        1.02,
    );

    // SPONSOR POSTERS — Zed and ElevenLabs in the world
    addPoster(makeBrandPoster("zed"), -10, 2.0, -14.8, 0, 0.85, 1.3);
    addPoster(makeBrandPoster("elevenlabs"), -8, 2.0, -14.8, 0, 0.85, 1.3);
    addPoster(
        makeBrandPoster("zed_defaced"),
        14.8,
        2.0,
        10,
        -Math.PI / 2,
        0.85,
        1.3,
    );
    addPoster(
        makeBrandPoster("elevenlabs_defaced"),
        5,
        2.0,
        14.8,
        Math.PI,
        0.85,
        1.3,
    );

    // ============ CLOCK + SURVEILLANCE CAMERAS ============
    function makeClockTexture(): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#e8dfc0";
        ctx.beginPath();
        ctx.arc(128, 128, 115, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#2a1a0a";
        ctx.lineWidth = 6;
        ctx.stroke();
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const r1 = i % 3 === 0 ? 90 : 97;
            ctx.strokeStyle = "#2a1a0a";
            ctx.lineWidth = i % 3 === 0 ? 4 : 2;
            ctx.beginPath();
            ctx.moveTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1);
            ctx.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108);
            ctx.stroke();
        }
        // Hands stopped at 11:11
        const hourA =
            (11 / 12) * Math.PI * 2 - Math.PI / 2 + (11 / 60) * (Math.PI / 6);
        const minA = (55 / 60) * Math.PI * 2 - Math.PI / 2;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#1a0a00";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(128, 128);
        ctx.lineTo(128 + Math.cos(hourA) * 62, 128 + Math.sin(hourA) * 62);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(128, 128);
        ctx.lineTo(128 + Math.cos(minA) * 85, 128 + Math.sin(minA) * 85);
        ctx.stroke();
        ctx.fillStyle = "#1a0a00";
        ctx.beginPath();
        ctx.arc(128, 128, 5, 0, Math.PI * 2);
        ctx.fill();
        // Crack lines
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(128, 128);
        ctx.lineTo(195, 75);
        ctx.moveTo(128, 128);
        ctx.lineTo(210, 155);
        ctx.moveTo(128, 128);
        ctx.lineTo(85, 190);
        ctx.stroke();
        applyAging(ctx, 256, 256);
        return new THREE.CanvasTexture(canvas);
    }
    // Clock on east wall — stopped at 11:11
    addPoster(makeClockTexture(), 14.8, 2.1, -12, -Math.PI / 2, 0.48, 0.48);

    // Surveillance cameras — geometry props on walls
    function addSurvCam(x: number, y: number, z: number, ry: number) {
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.08, 0.22),
            new THREE.MeshStandardMaterial({
                color: 0x111111,
                roughness: 0.5,
            }),
        );
        body.position.set(x, y, z);
        body.rotation.y = ry;
        scene.add(body);
        const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.03, 0.07, 8),
            new THREE.MeshStandardMaterial({
                color: 0x050505,
                metalness: 0.9,
                roughness: 0.1,
            }),
        );
        lens.rotation.x = Math.PI / 2;
        lens.position.set(
            x + Math.sin(ry) * -0.12,
            y,
            z + Math.cos(ry) * -0.12,
        );
        scene.add(lens);
        const led = new THREE.Mesh(
            new THREE.SphereGeometry(0.007, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xff0000 }),
        );
        led.position.set(x + 0.03, y + 0.03, z);
        scene.add(led);
    }
    addSurvCam(-14.5, 2.9, -13, Math.PI / 2); // NW corner
    addSurvCam(14.5, 2.9, 5, -Math.PI / 2); // east wall
    addSurvCam(0, 2.9, -14.5, 0); // north wall center

    // ============ GRAFFITI DECALS ============
    function addGraffiti(
        text: string,
        color: string,
        x: number,
        y: number,
        z: number,
        ry: number,
        w: number = 2.5,
    ) {
        const tex = makeGraffiti(text, color);
        const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
        decal.position.set(x, y, z);
        decal.rotation.y = ry;
        scene.add(decal);
    }

    // Graffiti placed around the station
    // Args: (text, color, x, y, z, ry, width-in-meters)
    // Decals are 2:1 aspect (width:height), so a width of 2.5m = 1.25m tall

    // West wall (x = -14.78), facing right (rotation = PI/2)
    addGraffiti("DON'T SPEAK", "#cc0000", -14.78, 1.5, -3, Math.PI / 2, 4.5);
    addGraffiti("HELP", "#dd0000", -14.78, 1.7, 12, Math.PI / 2, 1.8);

    // East wall (x = 14.78), facing left (rotation = -PI/2)
    addGraffiti("IT HEARS YOU", "#cc0000", 14.78, 1.6, -8, -Math.PI / 2, 4.8);
    addGraffiti("11:11", "#ee0000", 14.78, 1.0, 5, -Math.PI / 2, 1.6);

    // North wall (z = -14.78), facing south (rotation = 0)
    addGraffiti("RUN", "#dd0000", 5, 1.4, -14.78, 0, 1.8);

    // South wall (z = 14.78), facing north (rotation = PI)
    addGraffiti("WE'RE STILL ON AIR", "#cc0000", 0, 1.7, 14.78, Math.PI, 5.5);

    // ============ BLOODY HANDPRINTS ============
    function addBloodHand(
        x: number,
        y: number,
        z: number,
        ry: number,
        scale: number = 0.4,
    ) {
        const tex = makeBloodHand();
        const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const hand = new THREE.Mesh(new THREE.PlaneGeometry(scale, scale), mat);
        hand.position.set(x, y, z);
        hand.rotation.y = ry;
        hand.rotation.z = (Math.random() - 0.5) * 0.4;
        scene.add(hand);
    }

    // Place handprints on walls — bigger and more dramatic
    // West wall cluster (looks like someone was here, fell)
    addBloodHand(-14.78, 1.5, -7, Math.PI / 2, 0.7);
    addBloodHand(-14.78, 1.1, -6, Math.PI / 2, 0.6);
    addBloodHand(-14.78, 0.6, -5.5, Math.PI / 2, 0.55);
    // East wall — single dramatic print
    addBloodHand(14.78, 1.7, 0, -Math.PI / 2, 0.75);
    // South wall — handprint near the "WE'RE STILL ON AIR" graffiti
    addBloodHand(-5, 1.4, 14.78, Math.PI, 0.65);
    addBloodHand(-7, 0.7, 14.78, Math.PI, 0.5); // Lower one — slid down
    // North wall
    addBloodHand(8, 1.5, -14.78, 0, 0.6);

    // ============ DESK + MIC ============
    const desk = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 0.9, 1),
        new THREE.MeshStandardMaterial({ color: 0x3a2820, roughness: 0.7 }),
    );
    desk.position.set(-10, 0.45, -10);
    desk.castShadow = true;
    desk.receiveShadow = true;
    scene.add(desk);

    const micBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.15, 0.05, 16),
        new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            metalness: 0.9,
            roughness: 0.3,
        }),
    );
    micBase.position.set(-10, 0.92, -10);
    scene.add(micBase);

    const micStand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.5, 12),
        new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            metalness: 0.95,
            roughness: 0.2,
        }),
    );
    micStand.position.set(-10, 1.2, -10);
    scene.add(micStand);

    const micArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.3, 12),
        new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            metalness: 0.95,
            roughness: 0.2,
        }),
    );
    micArm.position.set(-10, 1.5, -10);
    micArm.rotation.z = Math.PI / 4;
    scene.add(micArm);

    const micHead = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 16, 16),
        new THREE.MeshStandardMaterial({
            color: 0x222,
            metalness: 0.6,
            roughness: 0.4,
        }),
    );
    micHead.position.set(-10.1, 1.6, -10);
    scene.add(micHead);

    // Bright visible lamp above the mic desk so the objective is readable in recordings
    const micLampShade = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.28, 24, 1, true),
        new THREE.MeshStandardMaterial({
            color: 0x2a2118,
            roughness: 0.45,
            metalness: 0.25,
            side: THREE.DoubleSide,
        }),
    );
    micLampShade.position.set(-10, 2.45, -10);
    micLampShade.rotation.x = Math.PI;
    scene.add(micLampShade);

    const micLampBulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xffe0a0 }),
    );
    micLampBulb.position.set(-10, 2.28, -10);
    scene.add(micLampBulb);

    const micDeskSpot = new THREE.SpotLight(
        0xffc078,
        5.0,
        7,
        Math.PI / 4.2,
        0.65,
        1.4,
    );
    micDeskSpot.position.set(-10, 2.55, -10);
    micDeskSpot.target.position.set(-10, 0.9, -10);
    micDeskSpot.castShadow = true;
    micDeskSpot.shadow.mapSize.width = 1024;
    micDeskSpot.shadow.mapSize.height = 1024;
    scene.add(micDeskSpot);
    scene.add(micDeskSpot.target);

    const micDeskGlow = new THREE.PointLight(0xffaa55, 1.9, 5.5);
    micDeskGlow.position.set(-10, 1.55, -10);
    scene.add(micDeskGlow);

    const mixingBoard = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.1, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }),
    );
    mixingBoard.position.set(-9.4, 0.95, -10);
    scene.add(mixingBoard);

    for (let i = 0; i < 6; i++) {
        const knob = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12),
            new THREE.MeshStandardMaterial({ color: 0xaa3030, metalness: 0.4 }),
        );
        knob.position.set(-9.95 + i * 0.2, 1.02, -10);
        scene.add(knob);
    }

    // ============ BROADCAST TERMINAL (win condition) ============
    const terminalGroup = new THREE.Group();
    terminalGroup.position.set(11, 0, 11);

    // Console body
    const terminal = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.4, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.7 }),
    );
    terminal.position.y = 0.7;
    terminalGroup.add(terminal);

    // CRT screen
    const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.6),
        new THREE.MeshBasicMaterial({ color: 0xff2020 }),
    );
    screen.position.set(0, 1.1, 0.31);
    terminalGroup.add(screen);

    // Bezel around screen
    const bezel = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.7, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.6 }),
    );
    bezel.position.set(0, 1.1, 0.3);
    terminalGroup.add(bezel);

    // Glowing red light to draw the eye
    const terminalLight = new THREE.PointLight(0xff1010, 1.5, 6);
    terminalLight.position.set(0, 1.1, 0.5);
    terminalGroup.add(terminalLight);

    // "TRANSMITTING" label above screen
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const lctx = labelCanvas.getContext("2d")!;
    lctx.fillStyle = "#000";
    lctx.fillRect(0, 0, 512, 128);
    lctx.fillStyle = "#ff3030";
    lctx.font = "bold 60px 'Courier New', monospace";
    lctx.textAlign = "center";
    lctx.fillText("TRANSMITTING", 256, 80);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 0.25),
        new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }),
    );
    labelMesh.position.set(0, 1.55, 0.31);
    terminalGroup.add(labelMesh);

    scene.add(terminalGroup);

    // ============ HAUNTED DOORS ============
    type HauntedDoor = {
        group: THREE.Group;
        slab: THREE.Mesh;
        creaked: boolean;
        openAmount: number;
        baseRotation: number;
    };
    const hauntedDoors: HauntedDoor[] = [];

    function addHauntedDoor(x: number, z: number, ry: number) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        group.rotation.y = ry;

        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(1.15, 2.15, 0.12),
            new THREE.MeshStandardMaterial({
                color: 0x120c08,
                roughness: 0.75,
            }),
        );
        frame.position.y = 1.08;
        group.add(frame);

        const slab = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 1.9, 0.08),
            new THREE.MeshStandardMaterial({
                color: 0x2b1a10,
                roughness: 0.82,
            }),
        );
        slab.position.set(0.06, 1.0, 0.08);
        slab.castShadow = true;
        slab.receiveShadow = true;
        group.add(slab);

        const knob = new THREE.Mesh(
            new THREE.SphereGeometry(0.045, 12, 12),
            new THREE.MeshStandardMaterial({
                color: 0xa87932,
                metalness: 0.7,
                roughness: 0.25,
            }),
        );
        knob.position.set(0.32, 1.0, 0.15);
        group.add(knob);

        const crackLight = new THREE.PointLight(0xff2020, 0.0, 2.5);
        crackLight.position.set(0, 1.15, 0.18);
        group.add(crackLight);

        scene.add(group);
        hauntedDoors.push({
            group,
            slab,
            creaked: false,
            openAmount: 0,
            baseRotation: ry,
        });
    }

    addHauntedDoor(-4, -5.18, 0);
    addHauntedDoor(5, 4.82, Math.PI);
    addHauntedDoor(8.18, -1.5, -Math.PI / 2);

    // ============ CHAIRS ============
    function addChair(
        x: number,
        z: number,
        ry: number = 0,
        knockedOver: boolean = false,
    ) {
        const group = new THREE.Group();
        const seat = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.08, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.9 }),
        );
        seat.position.y = 0.45;
        seat.castShadow = true;
        group.add(seat);
        const back = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.9 }),
        );
        back.position.set(0, 0.74, -0.22);
        back.castShadow = true;
        group.add(back);
        for (let i = 0; i < 4; i++) {
            const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.45, 8),
                new THREE.MeshStandardMaterial({
                    color: 0x1a1a1a,
                    metalness: 0.6,
                }),
            );
            const lx = (i % 2 === 0 ? -1 : 1) * 0.2;
            const lz = (i < 2 ? -1 : 1) * 0.2;
            leg.position.set(lx, 0.22, lz);
            group.add(leg);
        }
        group.position.set(x, 0, z);
        group.rotation.y = ry;
        if (knockedOver) {
            group.rotation.z = Math.PI / 2;
            group.position.y = 0.25;
        }
        scene.add(group);
    }
    addChair(-9, -8.5, 0.3);
    addChair(8, 8, -1.2);
    addChair(2, -12, 0.7, true);
    addChair(-3, 7, 2.1);

    // ============ ATMOSPHERIC DETAILS ============
    function addPaper(x: number, z: number) {
        const paper = new THREE.Mesh(
            new THREE.PlaneGeometry(0.2, 0.27),
            new THREE.MeshStandardMaterial({
                color: 0xddd2b8,
                roughness: 0.95,
                side: THREE.DoubleSide,
            }),
        );
        paper.position.set(x, 0.01, z);
        paper.rotation.x = -Math.PI / 2;
        paper.rotation.z = Math.random() * Math.PI;
        scene.add(paper);
    }
    for (let i = 0; i < 12; i++) {
        addPaper((Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25);
    }

    const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.04, 0.12, 12),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 }),
    );
    cup.position.set(-9.2, 0.96, -9.7);
    cup.rotation.z = Math.PI / 2;
    scene.add(cup);

    const stain = new THREE.Mesh(
        new THREE.CircleGeometry(0.15, 16),
        new THREE.MeshStandardMaterial({
            color: 0x3a2010,
            roughness: 1,
            transparent: true,
            opacity: 0.7,
        }),
    );
    stain.position.set(-9.0, 0.95, -9.7);
    stain.rotation.x = -Math.PI / 2;
    scene.add(stain);

    const wireMat = new THREE.MeshStandardMaterial({
        color: 0x111,
        roughness: 0.8,
    });
    for (let i = 0; i < 3; i++) {
        const wire = new THREE.Mesh(
            new THREE.CylinderGeometry(
                0.008,
                0.008,
                0.6 + Math.random() * 0.3,
                6,
            ),
            wireMat,
        );
        wire.position.set(
            8 + (Math.random() - 0.5) * 0.3,
            2.5 - 0.15 + Math.random() * 0.2,
            8 + (Math.random() - 0.5) * 0.3,
        );
        wire.rotation.z = (Math.random() - 0.5) * 0.4;
        scene.add(wire);
    }

    const brokenTile = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.6),
        new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            side: THREE.DoubleSide,
        }),
    );
    brokenTile.position.set(8, 2.95, 8);
    brokenTile.rotation.x = Math.PI / 2;
    scene.add(brokenTile);

    const recorder = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.3, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.6 }),
    );
    recorder.position.set(-11, 1.05, -10);
    scene.add(recorder);
    for (let i = 0; i < 2; i++) {
        const reel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8 }),
        );
        reel.position.set(-11.1 + i * 0.2, 1.22, -10);
        reel.rotation.x = Math.PI / 2;
        scene.add(reel);
    }

    // ============ STATIC TV ============
    const tvCanvas = document.createElement("canvas");
    tvCanvas.width = 128;
    tvCanvas.height = 96;
    const tvCtx = tvCanvas.getContext("2d")!;
    const tvTex = new THREE.CanvasTexture(tvCanvas);

    const tvBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.65, 0.45),
        new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.8 }),
    );
    tvBody.position.set(12, 1.15, -13.5);
    tvBody.rotation.y = -Math.PI / 5;
    scene.add(tvBody);

    const tvScreen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.52),
        new THREE.MeshBasicMaterial({ map: tvTex }),
    );
    tvScreen.position.set(12, 1.15, -13.5);
    tvScreen.rotation.y = -Math.PI / 5;
    tvScreen.translateZ(0.23);
    scene.add(tvScreen);

    const tvGlow = new THREE.PointLight(0x888888, 0.3, 3);
    tvGlow.position.set(12, 1.15, -13.5);
    scene.add(tvGlow);

    const tvStand = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.3, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.7 }),
    );
    tvStand.position.set(12, 0.65, -13.5);
    scene.add(tvStand);

    const tvBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.05, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.7 }),
    );
    tvBase.position.set(12, 0.5, -13.5);
    scene.add(tvBase);

    // ============ FALLEN FILE CABINET ============
    const cabinetMat = new THREE.MeshStandardMaterial({
        color: 0x4a5555,
        roughness: 0.7,
    });
    const cabinetBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 1.4, 0.55),
        cabinetMat,
    );
    cabinetBody.position.set(-13, 0.285, 6.5);
    cabinetBody.rotation.z = Math.PI / 2;
    scene.add(cabinetBody);

    for (let i = 0; i < 3; i++) {
        const drawer = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.27, 0.03),
            new THREE.MeshStandardMaterial({ color: 0x3a4545, roughness: 0.6 }),
        );
        drawer.position.set(-13, 0.28 + (i - 1) * 0.3, 6.5 + 0.28 + i * 0.02);
        scene.add(drawer);
    }

    const folderColors = [0x8a5520, 0x556030, 0x204060, 0x602020, 0x705030];
    for (let i = 0; i < 5; i++) {
        const folder = new THREE.Mesh(
            new THREE.PlaneGeometry(
                0.25 + Math.random() * 0.1,
                0.32 + Math.random() * 0.08,
            ),
            new THREE.MeshStandardMaterial({
                color: folderColors[i],
                roughness: 0.9,
                side: THREE.DoubleSide,
            }),
        );
        folder.position.set(
            -12.2 + (Math.random() - 0.5) * 1.5,
            0.005,
            6.5 + (Math.random() - 0.5) * 1.5,
        );
        folder.rotation.x = -Math.PI / 2;
        folder.rotation.z = (Math.random() - 0.5) * 1.2;
        scene.add(folder);
    }

    // ============ BLOOD POOLS ============
    function addBloodPool(x: number, z: number, r: number) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0x1e0000,
            roughness: 1,
            transparent: true,
            opacity: 0.9,
        });
        const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 10), mat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x, 0.005, z);
        scene.add(pool);
        for (let i = 0; i < 4; i++) {
            const drop = new THREE.Mesh(
                new THREE.CircleGeometry(r * (0.1 + Math.random() * 0.2), 7),
                mat,
            );
            drop.rotation.x = -Math.PI / 2;
            drop.position.set(
                x + (Math.random() - 0.5) * r * 2.5,
                0.006,
                z + (Math.random() - 0.5) * r * 2.5,
            );
            scene.add(drop);
        }
    }
    addBloodPool(-13.3, -6.3, 0.38); // west wall handprint cluster
    addBloodPool(-13.7, -4.8, 0.22);
    addBloodPool(-5.5, 13.3, 0.32); // south wall
    addBloodPool(-7.8, 13.6, 0.2); // slid-down print
    addBloodPool(13.2, 0.3, 0.3); // east wall dramatic print
    addBloodPool(7.8, -13.2, 0.25); // north wall

    // ============ MONSTER (THE LISTENER) ============
    const monster = new THREE.Group();

    // Tall, distorted humanoid silhouette
    const monsterBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.4, 1.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 }),
    );
    monsterBody.position.y = 1.0;
    monster.add(monsterBody);

    const monsterHead = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 }),
    );
    monsterHead.position.y = 2.05;
    monsterHead.scale.set(1, 1.3, 0.9);
    monster.add(monsterHead);

    // Glowing eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const leftEye = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 8),
        eyeMat,
    );
    leftEye.position.set(-0.07, 2.1, 0.18);
    monster.add(leftEye);
    const rightEye = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 8),
        eyeMat,
    );
    rightEye.position.set(0.07, 2.1, 0.18);
    monster.add(rightEye);

    // Long thin arms
    const armMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 1,
    });
    const leftArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.04, 1.3, 6),
        armMat,
    );
    leftArm.position.set(-0.35, 1.2, 0);
    leftArm.rotation.z = 0.15;
    monster.add(leftArm);
    const rightArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.04, 1.3, 6),
        armMat,
    );
    rightArm.position.set(0.35, 1.2, 0);
    rightArm.rotation.z = -0.15;
    monster.add(rightArm);

    // Spawn far from player
    monster.position.set(12, 0, 12);
    monster.visible = false; // hidden until aware
    scene.add(monster);

    // Monster state
    let monsterAwareness = 0; // 0 = idle, 1 = fully alert
    let monsterTarget = new THREE.Vector3(12, 0, 12);
    let monsterIdleTimer = 0;
    let gameOver = false;

    // ============ EXTRA VISUAL PROPS + COMPETITIVE OBJECTIVES ============

    // Animated static TV in the NE corner
    const propTvCanvas = document.createElement("canvas");
    propTvCanvas.width = 256;
    propTvCanvas.height = 192;
    const propTvCtx = propTvCanvas.getContext("2d")!;
    const propTvTexture = new THREE.CanvasTexture(propTvCanvas);

    const propTvBody = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.9, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.7 }),
    );
    propTvBody.position.set(13, 1.4, -13);
    propTvBody.rotation.y = -Math.PI / 4;
    scene.add(propTvBody);

    const propTvScreen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.95, 0.7),
        new THREE.MeshBasicMaterial({ map: propTvTexture }),
    );
    propTvScreen.position.set(13, 1.4, -13);
    propTvScreen.rotation.y = -Math.PI / 4;
    propTvScreen.position.x += Math.cos(-Math.PI / 4) * 0.46;
    propTvScreen.position.z += Math.sin(-Math.PI / 4) * 0.46;
    scene.add(propTvScreen);

    const propTvLight = new THREE.PointLight(0x4080a0, 0.6, 5);
    propTvLight.position.set(12, 1.4, -12);
    scene.add(propTvLight);

    const propTvStand = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 }),
    );
    propTvStand.position.set(13, 0.3, -13);
    propTvStand.rotation.y = -Math.PI / 4;
    scene.add(propTvStand);

    // Ceiling light fixtures
    function addDetailedCeilingFixture(
        x: number,
        z: number,
        broken: boolean = false,
    ): {
        bulb: THREE.Mesh;
        light: THREE.PointLight;
        broken: boolean;
    } {
        const plate = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 0.05, 0.3),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }),
        );
        plate.position.set(x, 2.97, z);
        scene.add(plate);

        const chain = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6),
            new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.8 }),
        );
        chain.position.set(x, 2.8, z);
        scene.add(chain);

        const shade = new THREE.Mesh(
            new THREE.ConeGeometry(0.18, 0.2, 12, 1, true),
            new THREE.MeshStandardMaterial({
                color: 0x2a2a2a,
                roughness: 0.5,
                metalness: 0.3,
                side: THREE.DoubleSide,
            }),
        );
        shade.position.set(x, 2.6, z);
        scene.add(shade);

        const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 12, 12),
            new THREE.MeshBasicMaterial({
                color: broken ? 0x000000 : 0xfff5d0,
            }),
        );
        bulb.position.set(x, 2.55, z);
        scene.add(bulb);

        const light = new THREE.PointLight(0xfff5d0, broken ? 0 : 0.8, 5);
        light.position.set(x, 2.5, z);
        scene.add(light);

        return { bulb, light, broken };
    }

    const detailedCeilingLights: {
        bulb: THREE.Mesh;
        light: THREE.PointLight;
        broken: boolean;
    }[] = [];
    detailedCeilingLights.push(addDetailedCeilingFixture(-7, 0, false));
    detailedCeilingLights.push(addDetailedCeilingFixture(0, -7, true));
    detailedCeilingLights.push(addDetailedCeilingFixture(7, 7, false));
    detailedCeilingLights.push(addDetailedCeilingFixture(-7, -10, true));
    detailedCeilingLights.push(addDetailedCeilingFixture(5, -3, false));

    // Blood pools and floor smears
    function addBloodSmearPool(x: number, z: number, scale: number = 1) {
        const pool = new THREE.Mesh(
            new THREE.CircleGeometry(0.4 * scale, 24),
            new THREE.MeshStandardMaterial({
                color: 0x4a0808,
                roughness: 0.4,
                metalness: 0.1,
            }),
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x, 0.012, z);
        scene.add(pool);

        const smear = new THREE.Mesh(
            new THREE.CircleGeometry(0.7 * scale, 24),
            new THREE.MeshStandardMaterial({
                color: 0x2a0404,
                roughness: 1,
                transparent: true,
                opacity: 0.8,
            }),
        );
        smear.rotation.x = -Math.PI / 2;
        smear.position.set(x, 0.011, z);
        smear.scale.x = 1 + Math.random() * 0.5;
        smear.scale.y = 1 + Math.random() * 0.3;
        scene.add(smear);

        const streak = new THREE.Mesh(
            new THREE.PlaneGeometry(0.2 * scale, 1.0 * scale),
            new THREE.MeshStandardMaterial({
                color: 0x2a0404,
                transparent: true,
                opacity: 0.7,
                roughness: 1,
            }),
        );
        streak.rotation.x = -Math.PI / 2;
        streak.rotation.z = Math.random() * Math.PI * 2;
        streak.position.set(
            x + (Math.random() - 0.5) * 0.4,
            0.011,
            z + (Math.random() - 0.5) * 0.4,
        );
        scene.add(streak);
    }

    addBloodSmearPool(-6, 12, 1.2);
    addBloodSmearPool(-2, 12, 0.7);
    addBloodSmearPool(10, 4, 1.0);
    addBloodSmearPool(-9, -6, 0.9);
    addBloodSmearPool(4, -10, 1.1);

    // Fallen file cabinet with spilled folders
    const cabinetGroup = new THREE.Group();
    cabinetGroup.position.set(11, 0, -7);
    cabinetGroup.rotation.z = Math.PI / 2;

    const cabinet = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 1.2, 0.4),
        new THREE.MeshStandardMaterial({
            color: 0x3a4a4a,
            roughness: 0.7,
            metalness: 0.4,
        }),
    );
    cabinet.position.set(0, 0.25, 0);
    cabinetGroup.add(cabinet);

    for (let i = 0; i < 3; i++) {
        const drawer = new THREE.Mesh(
            new THREE.BoxGeometry(0.51, 0.02, 0.42),
            new THREE.MeshStandardMaterial({ color: 0x1a2222, roughness: 0.5 }),
        );
        drawer.position.set(0, -0.3 + i * 0.3, 0);
        cabinetGroup.add(drawer);

        const handle = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.04, 0.04),
            new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 }),
        );
        handle.position.set(0, -0.3 + i * 0.3, 0.22);
        cabinetGroup.add(handle);
    }
    scene.add(cabinetGroup);

    for (let i = 0; i < 18; i++) {
        const isFolder = Math.random() < 0.4;
        const paper = new THREE.Mesh(
            new THREE.PlaneGeometry(
                isFolder ? 0.22 : 0.18,
                isFolder ? 0.3 : 0.24,
            ),
            new THREE.MeshStandardMaterial({
                color: isFolder ? 0xb89858 : 0xddd2b8,
                roughness: 0.95,
                side: THREE.DoubleSide,
            }),
        );
        paper.position.set(
            11 + (Math.random() - 0.5) * 2.5,
            0.011,
            -7 + (Math.random() - 0.5) * 2.5,
        );
        paper.rotation.x = -Math.PI / 2;
        paper.rotation.z = Math.random() * Math.PI * 2;
        scene.add(paper);
    }

    // Stopped clock at 11:11 on the north wall
    const clockGroup = new THREE.Group();
    clockGroup.position.set(0, 2.3, -14.78);

    const clockFace = new THREE.Mesh(
        new THREE.CircleGeometry(0.35, 32),
        new THREE.MeshStandardMaterial({ color: 0xe8dfc4, roughness: 0.6 }),
    );
    clockGroup.add(clockFace);

    const clockRim = new THREE.Mesh(
        new THREE.RingGeometry(0.35, 0.4, 32),
        new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.7,
            side: THREE.DoubleSide,
        }),
    );
    clockRim.position.z = 0.001;
    clockGroup.add(clockRim);

    const clockNumCanvas = document.createElement("canvas");
    clockNumCanvas.width = 256;
    clockNumCanvas.height = 256;
    const cnCtx = clockNumCanvas.getContext("2d")!;
    cnCtx.clearRect(0, 0, 256, 256);
    cnCtx.fillStyle = "#000";
    cnCtx.font = "bold 28px Georgia";
    cnCtx.textAlign = "center";
    cnCtx.textBaseline = "middle";
    cnCtx.fillText("12", 128, 30);
    cnCtx.fillText("3", 226, 128);
    cnCtx.fillText("6", 128, 226);
    cnCtx.fillText("9", 30, 128);
    const clockNumTex = new THREE.CanvasTexture(clockNumCanvas);
    const clockNumbers = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.7),
        new THREE.MeshBasicMaterial({ map: clockNumTex, transparent: true }),
    );
    clockNumbers.position.z = 0.005;
    clockGroup.add(clockNumbers);

    const hourHand = new THREE.Mesh(
        new THREE.PlaneGeometry(0.025, 0.18),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    hourHand.position.z = 0.008;
    hourHand.rotation.z = (30 * Math.PI) / 180;
    hourHand.position.x = -Math.sin((30 * Math.PI) / 180) * 0.06;
    hourHand.position.y = Math.cos((30 * Math.PI) / 180) * 0.06;
    clockGroup.add(hourHand);

    const minHand = new THREE.Mesh(
        new THREE.PlaneGeometry(0.02, 0.25),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    minHand.position.z = 0.009;
    const minAngle = (66 * Math.PI) / 180;
    minHand.rotation.z = -minAngle;
    minHand.position.x = Math.sin(minAngle) * 0.1;
    minHand.position.y = Math.cos(minAngle) * 0.1;
    clockGroup.add(minHand);

    const clockCenter = new THREE.Mesh(
        new THREE.CircleGeometry(0.02, 16),
        new THREE.MeshBasicMaterial({ color: 0xaa0000 }),
    );
    clockCenter.position.z = 0.01;
    clockGroup.add(clockCenter);

    scene.add(clockGroup);

    // Surveillance cameras with blinking LEDs
    function addSurveillanceCamera(
        x: number,
        y: number,
        z: number,
        ry: number,
    ) {
        const camGroup = new THREE.Group();

        const bracket = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.08, 0.15),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6 }),
        );
        bracket.position.z = 0.075;
        camGroup.add(bracket);

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.15, 0.25),
            new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.5 }),
        );
        body.position.z = 0.27;
        camGroup.add(body);

        const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12),
            new THREE.MeshStandardMaterial({
                color: 0x000000,
                metalness: 0.9,
                roughness: 0.1,
            }),
        );
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0, 0, 0.4);
        camGroup.add(lens);

        const led = new THREE.Mesh(
            new THREE.SphereGeometry(0.012, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff0000 }),
        );
        led.position.set(0.06, 0.05, 0.32);
        camGroup.add(led);

        camGroup.position.set(x, y, z);
        camGroup.rotation.y = ry;
        scene.add(camGroup);
        return led;
    }

    const surveillanceLeds = [
        addSurveillanceCamera(-14.5, 2.5, -14.5, Math.PI / 4),
        addSurveillanceCamera(14.5, 2.5, -14.5, -Math.PI / 4),
        addSurveillanceCamera(-14.5, 2.5, 14.5, (3 * Math.PI) / 4),
        addSurveillanceCamera(14.5, 2.5, 14.5, (-3 * Math.PI) / 4),
    ];

    // Competitive signal cores: collect all three before shutting down broadcast
    type SignalCore = {
        group: THREE.Group;
        orb: THREE.Mesh;
        light: THREE.PointLight;
        collected: boolean;
        baseY: number;
    };

    const signalCores: SignalCore[] = [];

    function addSignalCore(x: number, z: number) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        const pedestal = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.28, 0.35, 16),
            new THREE.MeshStandardMaterial({
                color: 0x141010,
                roughness: 0.55,
                metalness: 0.45,
            }),
        );
        pedestal.position.y = 0.18;
        group.add(pedestal);

        const orb = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.18, 1),
            new THREE.MeshBasicMaterial({ color: 0xff2020 }),
        );
        orb.position.y = 0.62;
        group.add(orb);

        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.28, 0.012, 8, 32),
            new THREE.MeshBasicMaterial({ color: 0xaa0000 }),
        );
        ring.position.y = 0.62;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);

        const light = new THREE.PointLight(0xff2020, 1.4, 4);
        light.position.set(0, 0.75, 0);
        group.add(light);

        scene.add(group);
        signalCores.push({
            group,
            orb,
            light,
            collected: false,
            baseY: group.position.y,
        });
    }

    addSignalCore(-12, 10);
    addSignalCore(12, -11);
    addSignalCore(2, -3);

    // ============ DUST ============
    const particleCount = 200;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleVelocities = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        particlePositions[i * 3] = (Math.random() - 0.5) * 30;
        particlePositions[i * 3 + 1] = Math.random() * 3;
        particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 30;
        particleVelocities[i * 3] = (Math.random() - 0.5) * 0.05;
        particleVelocities[i * 3 + 1] = -0.02 - Math.random() * 0.02;
        particleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    particleGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(particlePositions, 3),
    );
    const particleMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.03,
        transparent: true,
        opacity: 0.4,
        sizeAttenuation: true,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // ============ PLAYER ============
    const keys: Record<string, boolean> = {};
    const direction = new THREE.Vector3();
    let pitch = 0;
    let yaw = 0;
    const SPEED = 3;

    const overlay = document.getElementById("overlay");
    if (!overlay) {
        console.error("Overlay element not found!");
        return;
    }

    let audioReady = false;
    overlay.addEventListener("click", async () => {
        if (!audioReady) {
            // First click: load audio, then play intro narration
            const subtitle = document.getElementById("subtitle");
            if (subtitle) subtitle.textContent = "Loading audio...";
            await loadAllSounds();
            audioReady = true;
            if (subtitle) subtitle.textContent = "Click to enter the station";
        }
        try {
            await renderer.domElement.requestPointerLock();
            // Start ambient drone immediately
            startAmbient(0.35);
            // Play narrator intro with subtitle
            const introText =
                "You shouldn't be here. The station closed eleven years ago. But the broadcasts... the broadcasts never stopped. Find the source. And whatever you do... don't speak unless you have to.";
            showSubtitle(introText, 19000);
            playNarrator("narrator_intro", 1.0);
        } catch (err) {
            console.error("Pointer lock failed:", err);
        }
    });

    document.addEventListener("pointerlockchange", () => {
        if (document.pointerLockElement === renderer.domElement) {
            overlay.classList.add("hidden");
        } else {
            overlay.classList.remove("hidden");
        }
    });

    document.addEventListener("mousemove", (e) => {
        if (document.pointerLockElement !== renderer.domElement) return;
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(
            -Math.PI / 2 + 0.1,
            Math.min(Math.PI / 2 - 0.1, pitch),
        );
    });

    document.addEventListener("keydown", (e) => {
        keys[e.code] = true;
    });
    document.addEventListener("keyup", (e) => {
        keys[e.code] = false;
    });

    // Crouch indicator
    const crouchIndicator = document.getElementById("crouch-indicator");
    document.addEventListener("keydown", (e) => {
        if (
            (e.code === "ShiftLeft" || e.code === "ShiftRight") &&
            crouchIndicator
        ) {
            crouchIndicator.textContent = "CROUCHING — SILENT";
            crouchIndicator.classList.add("visible");
        }
    });
    document.addEventListener("keyup", (e) => {
        if (
            (e.code === "ShiftLeft" || e.code === "ShiftRight") &&
            crouchIndicator
        ) {
            crouchIndicator.classList.remove("visible");
        }
    });

    // Game over click-to-restart
    const gameoverEl = document.getElementById("gameover");
    if (gameoverEl) {
        gameoverEl.addEventListener("click", () => {
            location.reload();
        });
    }

    const victoryEl = document.getElementById("victory");
    if (victoryEl) {
        victoryEl.addEventListener("click", () => {
            location.reload();
        });
    }

    function triggerGameOver() {
        if (gameOver || escaped) return;
        gameOver = true;

        for (const key of Object.keys(keys)) {
            keys[key] = false;
        }

        hideInteractionPrompt();
        setHeartbeatRate(0);
        updateMonsterBreath(1, 0);
        dangerVignetteEl?.classList.remove("warn", "danger");
        document
            .getElementById("recording-prompt")
            ?.classList.remove("visible");
        document.getElementById("cloning-status")?.classList.remove("visible");
        document
            .getElementById("crouch-indicator")
            ?.classList.remove("visible");

        playOneShot("monster_caught_scream", 1.0);
        if (gameoverEl) {
            setTimeout(() => {
                if (escaped) return;
                gameoverEl.classList.add("visible");
            }, 300);
        }
        if (document.pointerLockElement) document.exitPointerLock();
    }

    function triggerVictory() {
        if (escaped || gameOver) return;
        escaped = true;

        for (const key of Object.keys(keys)) {
            keys[key] = false;
        }

        hideInteractionPrompt();
        dangerVignetteEl?.classList.remove("warn", "danger");
        document
            .getElementById("recording-prompt")
            ?.classList.remove("visible");
        document.getElementById("cloning-status")?.classList.remove("visible");
        document
            .getElementById("crouch-indicator")
            ?.classList.remove("visible");

        const finalElapsed = performance.now() - runStartTime;
        const finalRank = getRunRank(finalElapsed);
        const victoryTimeEl = document.getElementById("victory-time");
        const victoryRankEl = document.getElementById("victory-rank");
        if (victoryTimeEl)
            victoryTimeEl.textContent = `TIME: ${formatRunTime(finalElapsed)}`;
        if (victoryRankEl) {
            victoryRankEl.textContent = `RANK: ${finalRank.label}`;
            victoryRankEl.classList.remove("rank-s", "rank-a");
            if (finalRank.className)
                victoryRankEl.classList.add(finalRank.className);
        }

        setObjectiveState(objectiveTerminalEl, "complete");

        // Stop monster
        monster.visible = false;
        monsterAwareness = 0;
        setHeartbeatRate(0);
        updateMonsterBreath(1, 0); // mute breathing

        // Black out terminal
        screen.material = new THREE.MeshBasicMaterial({ color: 0x000000 });
        labelMesh.visible = false;
        terminalLight.intensity = 0;

        // Static burst then narrator
        playOneShot("static_burst", 0.5);
        setTimeout(() => {
            if (gameOver) return;
            showSubtitle(
                "The signal is dead. The broadcasts are over. You can leave now.",
                8000,
            );
            // Show victory screen after the line
            setTimeout(() => {
                if (gameOver) return;
                const victoryEl = document.getElementById("victory");
                if (victoryEl) victoryEl.classList.add("visible");
                if (document.pointerLockElement) document.exitPointerLock();
            }, 7000);
        }, 800);
    }

    async function startVoiceCloningSequence() {
        if (voiceCloneStarted || escaped || gameOver) return;
        voiceCloneStarted = true;

        // Step 1: Narrator asks player to speak
        await playNarrator("narrator_record_request", 1.0);
        if (escaped || gameOver) return;
        showSubtitle("Wait. Something wants to hear you. Speak.", 5000);

        // Step 2: Show recording prompt with a line to read
        const recPrompt = document.getElementById("recording-prompt");
        const recLine = document.getElementById("rec-line");
        const recTimer = document.getElementById("rec-timer");
        const recSub = document.getElementById("rec-sub");

        const lineToRead =
            "I am alone in this place. The lights flicker. The walls remember. I should not have come here, but I am here now, and I am listening. I will speak so that someone, somewhere, may hear me.";

        if (recLine) recLine.textContent = lineToRead;
        if (recSub) {
            recSub.textContent =
                "Speak clearly in your normal voice. Stay close to the mic until the timer ends.";
        }
        if (recPrompt) recPrompt.classList.add("visible");

        // Countdown timer
        let secondsLeft = 20;
        const tick = () => {
            if (recTimer) recTimer.textContent = String(secondsLeft);
            secondsLeft--;
        };
        tick();
        const timerInterval = window.setInterval(tick, 1000);

        try {
            // Step 3: Record 20 seconds for a clearer voice clone
            const audioBlob = await recordVoiceSample(20000);
            clearInterval(timerInterval);
            if (recPrompt) recPrompt.classList.remove("visible");

            if (escaped || gameOver) {
                return;
            }

            // Step 4: Show cloning status
            const cloneStatus = document.getElementById("cloning-status");
            if (cloneStatus) cloneStatus.classList.add("visible");

            // Step 5: Send to ElevenLabs to clone
            console.log("Cloning voice...");
            clonedVoiceId = await cloneVoice(audioBlob);
            console.log("Voice cloned! ID:", clonedVoiceId);

            if (escaped || gameOver) {
                if (cloneStatus) cloneStatus.classList.remove("visible");
                return;
            }

            // Step 6: Pre-generate whisper TTS buffers
            console.log("Generating whisper lines...");
            const whisperPromises = PLAYER_WHISPERS.slice(0, 5).map((line) =>
                ttsAsPlayer(clonedVoiceId!, line).catch((err) => {
                    console.error("Whisper TTS failed:", err);
                    return null;
                }),
            );
            const results = await Promise.all(whisperPromises);
            clonedWhisperBuffers = results.filter(
                (b): b is AudioBuffer => b !== null,
            );
            console.log(`Got ${clonedWhisperBuffers.length} whisper buffers`);

            if (cloneStatus) cloneStatus.classList.remove("visible");

            if (escaped || gameOver) {
                return;
            }

            // Step 7: Narrator delivers the punchline
            await playNarrator("narrator_clone_done", 1.0);
            if (escaped || gameOver) return;
            showSubtitle("It has your voice now.", 5000);

            // Activate the cloned-whisper threat
            cloneWhisperTimer = 12; // first whisper in 12 seconds
        } catch (err) {
            console.error("Voice cloning failed:", err);
            if (recPrompt) recPrompt.classList.remove("visible");
            const cloneStatus = document.getElementById("cloning-status");
            if (cloneStatus) cloneStatus.classList.remove("visible");
            showSubtitle("The signal was lost. Continue without it.", 4000);
            clearInterval(timerInterval);
        }
    }

    let brightMode = true;
    document.addEventListener("keydown", (e) => {
        if (e.code === "KeyB") {
            brightMode = !brightMode;

            // B mode is now "clear cinematic visibility" for recording:
            // still dark and scary, but with less fog/grain and a stronger flashlight.
            ambient.intensity = brightMode ? 2.15 : 0.85;
            scene.fog = brightMode
                ? new THREE.FogExp2(0x000000, 0.016)
                : new THREE.FogExp2(0x000000, 0.045);

            renderer.toneMappingExposure = brightMode ? 1.0 : 1.22;
            cinematicPass.uniforms.uChromatic.value = brightMode
                ? 0.0035
                : 0.0012;
            cinematicPass.uniforms.uGrain.value = brightMode ? 0.045 : 0.02;
            cinematicPass.uniforms.uContrast.value = brightMode ? 1.08 : 1.02;
            cinematicPass.uniforms.uSaturation.value = brightMode ? 0.95 : 1.05;

            console.log(
                brightMode ? "☀️ Bright mode" : "🎥 Clear cinematic dark mode",
            );
        }
    });

    function tryMove(delta: THREE.Vector3) {
        const next = camera.position.clone().add(delta);
        const padding = 0.3;
        for (const wall of walls) {
            const box = new THREE.Box3()
                .setFromObject(wall)
                .expandByScalar(padding);
            if (
                next.x > box.min.x &&
                next.x < box.max.x &&
                next.z > box.min.z &&
                next.z < box.max.z
            ) {
                return;
            }
        }
        camera.position.copy(next);
    }

    // ============ ANIMATE ============
    let flickerTime = 0;
    let bobTime = 0;
    let breathTime = 0;
    const clock = new THREE.Clock();
    let footstepAccum = 0.4;
    let micFound = false;
    let whisperTimer = 25; // first whisper at ~25s in
    let soundLevel = 0;
    let scrapeTimer = 8;
    let currentY = 1.7;
    let voiceCloneStarted = false;
    let clonedVoiceId: string | null = null;
    let clonedWhisperBuffers: AudioBuffer[] = [];
    let cloneWhisperTimer = 999;
    let escaped = false;
    let monsterStepAccum = 0;
    let tvStaticTimer = 0;
    let screamTimer = 35 + Math.random() * 25;

    // Competitive run state
    let coresCollected = 0;
    let terminalLockedCooldown = 0;
    let coreFlashActive = false;
    const runStartTime = performance.now();

    const dangerVignetteEl = document.getElementById("danger-vignette");
    const objectiveMicEl = document.getElementById("objective-mic");
    const objectiveCoresEl = document.getElementById("objective-cores");
    const objectiveTerminalEl = document.getElementById("objective-terminal");
    const coreCounterEl = document.getElementById("core-counter");
    const runTimerEl = document.getElementById("run-timer");
    const rankPreviewEl = document.getElementById("rank-preview");
    const interactionPromptEl = document.getElementById("interaction-prompt");

    function formatRunTime(ms: number): string {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    function getRunRank(elapsedMs: number): {
        label: string;
        className: string;
    } {
        if (elapsedMs <= 120000) {
            return { label: "S+ SIGNAL BREAKER", className: "rank-s" };
        }
        if (elapsedMs <= 180000) {
            return { label: "A VOICEPRINT SURVIVOR", className: "rank-a" };
        }
        return { label: "B BROADCAST ESCAPEE", className: "" };
    }

    function setObjectiveState(
        el: HTMLElement | null,
        state: "active" | "complete" | "idle",
    ) {
        if (!el) return;
        el.classList.remove("active", "complete");
        if (state !== "idle") el.classList.add(state);
    }

    function updateCompetitiveHud(elapsed = performance.now() - runStartTime) {
        if (runTimerEl) runTimerEl.textContent = formatRunTime(elapsed);
        if (coreCounterEl) {
            coreCounterEl.textContent = `SIGNAL CORES: ${coresCollected}/${signalCores.length}`;
        }
        if (rankPreviewEl) {
            rankPreviewEl.textContent = `RANK: ${getRunRank(elapsed).label}`;
        }

        setObjectiveState(objectiveMicEl, micFound ? "complete" : "active");
        setObjectiveState(
            objectiveCoresEl,
            !micFound
                ? "idle"
                : coresCollected >= signalCores.length
                  ? "complete"
                  : "active",
        );
        setObjectiveState(
            objectiveTerminalEl,
            coresCollected >= signalCores.length ? "active" : "idle",
        );
    }

    function showInteractionPrompt(
        text: string,
        state: "locked" | "ready" = "ready",
    ) {
        if (!interactionPromptEl) return;
        interactionPromptEl.textContent = text;
        interactionPromptEl.classList.remove("locked", "ready");
        interactionPromptEl.classList.add("visible", state);
    }

    function hideInteractionPrompt() {
        if (!interactionPromptEl) return;
        interactionPromptEl.classList.remove("visible", "locked", "ready");
    }

    function flashCoreCollected() {
        if (coreFlashActive) return;
        coreFlashActive = true;
        const flash = document.createElement("div");
        flash.className = "core-collected-flash";
        document.body.appendChild(flash);
        setTimeout(() => {
            flash.remove();
            coreFlashActive = false;
        }, 700);
    }

    function collectSignalCore(core: SignalCore) {
        if (core.collected) return;
        core.collected = true;
        coresCollected++;
        core.group.visible = false;
        core.light.intensity = 0;
        playOneShot("static_burst", 0.18, 1.4);
        flashCoreCollected();

        // Competitive pressure: each recovered core briefly alerts the monster.
        soundLevel = Math.min(1, soundLevel + 0.45);
        if (monster.visible && !escaped && !gameOver) {
            monsterAwareness = Math.min(1, monsterAwareness + 0.25);
            monsterTarget.set(camera.position.x, 0, camera.position.z);
            scrapeTimer = Math.min(scrapeTimer, 1.2);
        }

        if (coresCollected >= signalCores.length) {
            showSubtitle(
                "All signal cores recovered. The broadcast terminal is vulnerable.",
                5500,
            );
            terminalLight.color.set(0x66ff99);
            terminalLight.intensity = 2.2;
            if (coreCounterEl) coreCounterEl.textContent = "SIGNAL CORES: 3/3";
        } else {
            showSubtitle(
                `Signal core recovered. ${signalCores.length - coresCollected} remaining.`,
                3500,
            );
        }
        updateCompetitiveHud();
    }

    function animate() {
        const dt = clock.getDelta();
        const time = performance.now() * 0.001;
        const elapsedMs = performance.now() - runStartTime;
        let distToPlayer = 999;

        if (!gameOver && !escaped) {
            updateCompetitiveHud(elapsedMs);
            camera.rotation.order = "YXZ";
            camera.rotation.y = yaw;
            camera.rotation.x = pitch;

            const isCrouching = keys["ShiftLeft"] || keys["ShiftRight"];
            const speed = isCrouching ? SPEED * 0.5 : SPEED;

            direction.set(0, 0, 0);
            if (keys["KeyW"]) direction.z -= 1;
            if (keys["KeyS"]) direction.z += 1;
            if (keys["KeyA"]) direction.x -= 1;
            if (keys["KeyD"]) direction.x += 1;
            direction.normalize();

            const isMoving = direction.lengthSq() > 0;
            if (isMoving) {
                const move = new THREE.Vector3(direction.x, 0, direction.z)
                    .applyEuler(new THREE.Euler(0, yaw, 0))
                    .multiplyScalar(speed * dt);
                tryMove(new THREE.Vector3(move.x, 0, 0));
                tryMove(new THREE.Vector3(0, 0, move.z));
                bobTime += dt * (isCrouching ? 5 : 8);
            } else {
                bobTime *= 0.95;
            }

            // ============ FOOTSTEPS ============
            if (isMoving) {
                footstepAccum += dt;
                const stepInterval = isCrouching ? 0.7 : 0.45;
                if (footstepAccum > stepInterval) {
                    footstepAccum = 0;
                    if (!isCrouching) {
                        playRandomFootstep(0.5);
                        // Loud footstep increases monster awareness
                        soundLevel = Math.min(1, soundLevel + 0.35);
                    } else {
                        playRandomFootstep(0.1);
                        soundLevel = Math.min(1, soundLevel + 0.05);
                    }
                }
            } else {
                footstepAccum = 0.4;
            }

            // ============ MICROPHONE TRIGGER ============
            if (!micFound) {
                const dx = camera.position.x - -10;
                const dz = camera.position.z - -10;
                if (dx * dx + dz * dz < 4) {
                    micFound = true;
                    setTimeout(() => {
                        showSubtitle(
                            "You found the microphone. It's still warm. Someone was just here.",
                            7000,
                        );
                        playNarrator("narrator_mic_found", 1.0);
                        // Monster activates after this discovery
                        setTimeout(() => {
                            if (escaped || gameOver) return;
                            monster.visible = true;
                            startMonsterBreath();
                        }, 8000);
                        // Voice cloning sequence starts ~8s after mic found
                        setTimeout(() => {
                            if (escaped || gameOver) return;
                            startVoiceCloningSequence();
                        }, 8000);
                    }, 800);
                }
            }

            let promptShown = false;

            // ============ SIGNAL CORE COLLECTION ============
            if (micFound) {
                for (const core of signalCores) {
                    if (core.collected) continue;

                    const dxc = camera.position.x - core.group.position.x;
                    const dzc = camera.position.z - core.group.position.z;
                    const coreDistSq = dxc * dxc + dzc * dzc;

                    if (coreDistSq < 4) {
                        promptShown = true;
                        showInteractionPrompt("SIGNAL CORE DETECTED", "ready");
                    }

                    if (coreDistSq < 1.35) {
                        collectSignalCore(core);
                    }
                }
            }

            // ============ BROADCAST TERMINAL — WIN CONDITION ============
            if (!escaped && monster.visible) {
                const dxt = camera.position.x - 11;
                const dzt = camera.position.z - 11;
                const terminalDistSq = dxt * dxt + dzt * dzt;

                if (terminalDistSq < 6.25) {
                    promptShown = true;

                    if (coresCollected >= signalCores.length) {
                        showInteractionPrompt(
                            "BROADCAST TERMINAL READY",
                            "ready",
                        );
                        if (terminalDistSq < 4 && !escaped && !gameOver) {
                            triggerVictory();
                        }
                    } else {
                        showInteractionPrompt(
                            `TERMINAL LOCKED — ${signalCores.length - coresCollected} SIGNAL CORES REMAIN`,
                            "locked",
                        );

                        terminalLockedCooldown -= dt;
                        if (terminalLockedCooldown <= 0 && terminalDistSq < 4) {
                            terminalLockedCooldown = 4;
                            showSubtitle(
                                "The terminal is locked. Recover the signal cores first.",
                                3000,
                            );
                        }
                    }
                }

                // Pulse the terminal light to draw eye
                terminalLight.intensity =
                    coresCollected >= signalCores.length
                        ? 1.8 + Math.sin(performance.now() * 0.006) * 0.7
                        : 1.2 + Math.sin(performance.now() * 0.005) * 0.5;
            }

            if (!promptShown) {
                hideInteractionPrompt();
            }

            // ============ HAUNTED DOORS ============
            for (const door of hauntedDoors) {
                const dxd = camera.position.x - door.group.position.x;
                const dzd = camera.position.z - door.group.position.z;
                const doorDistSq = dxd * dxd + dzd * dzd;

                if (!door.creaked && doorDistSq < 9) {
                    door.creaked = true;
                    door.openAmount = 1;
                    playOneShot(
                        "door_creak",
                        0.55,
                        0.85 + Math.random() * 0.25,
                    );
                }

                if (door.openAmount > 0.01) {
                    door.slab.rotation.y +=
                        (0.55 - door.slab.rotation.y) * 0.03;
                    door.openAmount *= 0.985;
                }
            }

            // ============ AMBIENT WHISPERS + DISTANT SCREAMS ============
            whisperTimer -= dt;
            if (whisperTimer <= 0) {
                whisperTimer = 18 + Math.random() * 22;
                if (Math.random() < 0.7) {
                    playOneShot("distant_whisper", 0.3 + Math.random() * 0.2);
                } else {
                    playOneShot("static_burst", 0.15);
                }
            }

            screamTimer -= dt;
            if (monster.visible && screamTimer <= 0) {
                screamTimer = 45 + Math.random() * 35;
                playOneShot(
                    "monster_caught_scream",
                    0.16,
                    0.65 + Math.random() * 0.25,
                );
            }

            // ============ CAMERA HEIGHT (with crouch) ============
            breathTime += dt * 1.2;
            const targetY = isCrouching ? 1.0 : 1.7;
            currentY += (targetY - currentY) * 0.15;
            const bob = isMoving
                ? Math.sin(bobTime) * (isCrouching ? 0.02 : 0.04)
                : 0;
            const breath = Math.sin(breathTime) * 0.008;
            camera.position.y = currentY + bob + breath;

            // ============ SOUND METER DECAY ============
            soundLevel = Math.max(0, soundLevel - dt * 0.4);
            const fillEl = document.getElementById("sound-fill");
            if (fillEl) fillEl.style.width = `${soundLevel * 100}%`;

            // ============ MONSTER AI ============
            if (monster.visible) {
                const dxm = camera.position.x - monster.position.x;
                const dzm = camera.position.z - monster.position.z;
                distToPlayer = Math.sqrt(dxm * dxm + dzm * dzm);

                // Awareness rises when player is loud, decays otherwise
                if (soundLevel > 0.2) {
                    monsterAwareness = Math.min(
                        1,
                        monsterAwareness + dt * soundLevel * 1.5,
                    );
                } else {
                    monsterAwareness = Math.max(
                        0,
                        monsterAwareness - dt * 0.15,
                    );
                }

                // Movement
                if (monsterAwareness > 0.3) {
                    // Hunting — move toward player
                    monsterTarget.set(camera.position.x, 0, camera.position.z);
                    monsterIdleTimer = 0;
                } else {
                    // Idle wander
                    monsterIdleTimer -= dt;
                    if (monsterIdleTimer <= 0) {
                        monsterIdleTimer = 4 + Math.random() * 4;
                        monsterTarget.set(
                            (Math.random() - 0.5) * 24,
                            0,
                            (Math.random() - 0.5) * 24,
                        );
                    }
                }

                // Move monster toward target
                const tdx = monsterTarget.x - monster.position.x;
                const tdz = monsterTarget.z - monster.position.z;
                const tdist = Math.sqrt(tdx * tdx + tdz * tdz);
                if (tdist > 0.1) {
                    const moveSpeed = monsterAwareness > 0.3 ? 1.4 : 0.6;
                    monster.position.x += (tdx / tdist) * moveSpeed * dt;
                    monster.position.z += (tdz / tdist) * moveSpeed * dt;
                    // Face direction of movement
                    monster.rotation.y = Math.atan2(tdx, tdz);
                }

                // 3D audio: distance + stereo pan
                const maxAudibleDist = 14;
                const normDist = Math.min(1, distToPlayer / maxAudibleDist);
                // Pan based on monster's position relative to camera facing
                const relAngle = Math.atan2(dxm, dzm) - yaw;
                const pan = Math.sin(relAngle);
                updateMonsterBreath(normDist, -pan);

                // Heartbeat ramps up as monster gets close
                if (distToPlayer < 6) {
                    const bpm = 70 + (1 - distToPlayer / 6) * 90;
                    setHeartbeatRate(bpm);
                } else {
                    setHeartbeatRate(0);
                }

                // Random scrape sounds when nearby
                scrapeTimer -= dt;
                if (scrapeTimer <= 0 && distToPlayer < 8) {
                    scrapeTimer = 4 + Math.random() * 6;
                    playOneShot(
                        "monster_scrape",
                        0.25 + (1 - distToPlayer / 8) * 0.4,
                    );
                }

                // Cloned-voice whispers (if available)
                if (clonedWhisperBuffers.length > 0) {
                    cloneWhisperTimer -= dt;
                    if (cloneWhisperTimer <= 0) {
                        cloneWhisperTimer = 5 + Math.random() * 8; // every 5-13s
                        const whisperBuf =
                            clonedWhisperBuffers[
                                Math.floor(
                                    Math.random() * clonedWhisperBuffers.length,
                                )
                            ];
                        const monsterDist = Math.min(1, distToPlayer / 14);
                        const whisperPan = Math.sin(relAngle);
                        playBufferAsMonsterWhisper(
                            whisperBuf,
                            monsterDist,
                            -whisperPan,
                        );
                    }
                }

                // CAUGHT
                if (distToPlayer < 1.5) {
                    triggerGameOver();
                }

                // ============ MONSTER ANIMATION ============
                const mt = performance.now() * 0.001;
                const hunt = monsterAwareness > 0.3;
                const limbSwing = hunt ? 0.75 : 0.2;
                leftArm.rotation.x =
                    Math.sin(mt * (hunt ? 3.0 : 1.5)) * limbSwing;
                rightArm.rotation.x =
                    Math.sin(mt * (hunt ? 3.0 : 1.5) + Math.PI) * limbSwing;
                leftArm.rotation.z = 0.15 + Math.sin(mt * 0.8) * 0.08;
                rightArm.rotation.z = -0.15 - Math.sin(mt * 0.8) * 0.08;
                monsterHead.rotation.y =
                    Math.sin(mt * (hunt ? 1.5 : 0.6)) * 0.35;
                monsterBody.position.y =
                    1.0 + Math.sin(mt * (hunt ? 2.4 : 1.1)) * 0.04;

                // Monster footsteps
                monsterStepAccum +=
                    dt *
                    (tdist > 0.1 ? (monsterAwareness > 0.3 ? 1.4 : 0.6) : 0);
                if (monsterStepAccum > 1.1) {
                    monsterStepAccum = 0;
                    if (distToPlayer < 14) {
                        playOneShot(
                            "monster_step",
                            Math.min(
                                0.55,
                                0.1 + (1 - distToPlayer / 14) * 0.45,
                            ),
                            0.85 + Math.random() * 0.3,
                        );
                    }
                }

                // Camera shake when monster is very close
                if (distToPlayer < 3.5) {
                    const shake = (1 - distToPlayer / 3.5) * 0.016;
                    camera.position.x += (Math.random() - 0.5) * shake;
                    camera.position.z += (Math.random() - 0.5) * shake;
                }

                // Red danger vignette
                if (dangerVignetteEl) {
                    dangerVignetteEl.classList.remove("warn", "danger");

                    if (distToPlayer < 3) {
                        dangerVignetteEl.classList.add("danger");
                    } else if (distToPlayer < 7) {
                        dangerVignetteEl.classList.add("warn");
                    }
                }
            } else if (dangerVignetteEl) {
                dangerVignetteEl.classList.remove("warn", "danger");
            }

            // ============ FLICKER LIGHTS ============
            flickerTime += dt;
            emergency.intensity =
                0.5 +
                Math.sin(flickerTime * 2.3) * 0.15 +
                (Math.random() < 0.02 ? -0.4 : 0);
            brokenLight.intensity =
                0.3 + Math.random() * 0.5 * (Math.random() < 0.1 ? 1 : 0);
            flashlight.intensity = brightMode
                ? 6.2 + Math.random() * 0.5
                : 7.8 + Math.random() * 0.35;

            // ============ ANIMATED STATIC TV ============
            tvStaticTimer += dt;
            if (tvStaticTimer > 0.05) {
                tvStaticTimer = 0;
                const tvImg = propTvCtx.createImageData(256, 192);
                for (let i = 0; i < tvImg.data.length; i += 4) {
                    const v = Math.random() * 255;
                    tvImg.data[i] = v;
                    tvImg.data[i + 1] = v;
                    tvImg.data[i + 2] = v;
                    tvImg.data[i + 3] = 255;
                }
                propTvCtx.putImageData(tvImg, 0, 0);

                if (Math.random() < 0.08) {
                    const yLine = Math.floor(Math.random() * 192);
                    propTvCtx.fillStyle = "rgba(255,255,255,0.65)";
                    propTvCtx.fillRect(0, yLine, 256, 2 + Math.random() * 7);
                }

                if (Math.random() < 0.12) {
                    propTvCtx.save();
                    propTvCtx.translate(
                        Math.random() * 12 - 6,
                        Math.random() * 8 - 4,
                    );
                    propTvCtx.fillStyle =
                        Math.random() < 0.5 ? "#ff2020" : "#ffffff";
                    propTvCtx.font = "bold 30px 'Courier New', monospace";
                    propTvCtx.textAlign = "center";
                    propTvCtx.shadowColor = "#ff0000";
                    propTvCtx.shadowBlur = 12;
                    propTvCtx.fillText("ELEVENHACKS", 128, 104);
                    propTvCtx.globalAlpha = 0.35;
                    propTvCtx.fillStyle = "#ff0000";
                    propTvCtx.fillRect(20 + Math.random() * 40, 112, 190, 3);
                    propTvCtx.restore();
                }

                if (Math.random() < 0.01) {
                    propTvCtx.fillStyle = "rgba(0,0,0,0.85)";
                    propTvCtx.fillRect(
                        80 + Math.random() * 96,
                        30,
                        30 + Math.random() * 30,
                        130,
                    );
                }

                propTvTexture.needsUpdate = true;

                // Earlier small TV also flickers with its own lower-res static
                const smallTvImg = tvCtx.createImageData(128, 96);
                for (let i = 0; i < smallTvImg.data.length; i += 4) {
                    const v = Math.random() * 255;
                    smallTvImg.data[i] = v;
                    smallTvImg.data[i + 1] = v;
                    smallTvImg.data[i + 2] = v;
                    smallTvImg.data[i + 3] = 255;
                }
                tvCtx.putImageData(smallTvImg, 0, 0);

                if (Math.random() < 0.06) {
                    const yLine = Math.floor(Math.random() * 96);
                    tvCtx.fillStyle = "rgba(255,255,255,0.55)";
                    tvCtx.fillRect(0, yLine, 128, 1 + Math.random() * 4);
                }

                if (Math.random() < 0.1) {
                    tvCtx.save();
                    tvCtx.translate(
                        Math.random() * 6 - 3,
                        Math.random() * 4 - 2,
                    );
                    tvCtx.fillStyle =
                        Math.random() < 0.5 ? "#ff3030" : "#ffffff";
                    tvCtx.font = "bold 14px 'Courier New', monospace";
                    tvCtx.textAlign = "center";
                    tvCtx.shadowColor = "#ff0000";
                    tvCtx.shadowBlur = 6;
                    tvCtx.fillText("ELEVENHACKS", 64, 54);
                    tvCtx.restore();
                }

                tvTex.needsUpdate = true;
            }
            propTvLight.intensity = 0.35 + Math.random() * 0.55;
            tvGlow.intensity = 0.2 + Math.random() * 0.45;

            // ============ CEILING LIGHT FIXTURES ============
            for (const cl of detailedCeilingLights) {
                const bulbMat = cl.bulb.material as THREE.MeshBasicMaterial;
                if (cl.broken) {
                    if (Math.random() < 0.005) {
                        cl.light.intensity = 0.6;
                        bulbMat.color.set(0xfff5d0);
                    } else {
                        cl.light.intensity *= 0.85;
                        if (cl.light.intensity < 0.05) {
                            bulbMat.color.set(0x000000);
                        }
                    }
                } else {
                    cl.light.intensity = 0.68 + Math.random() * 0.22;
                    bulbMat.color.set(0xfff5d0);
                }
            }

            // ============ SURVEILLANCE LEDS ============
            const ledTime = performance.now() * 0.001;
            for (let i = 0; i < surveillanceLeds.length; i++) {
                const blink =
                    Math.sin(ledTime * (1.8 + i * 0.3)) > 0.7 ? 1 : 0.18;
                const ledMat = surveillanceLeds[i]
                    .material as THREE.MeshBasicMaterial;
                ledMat.color.setRGB(blink, 0, 0);
            }

            // ============ SIGNAL CORE VISUALS ============
            const coreTime = performance.now() * 0.001;
            for (let i = 0; i < signalCores.length; i++) {
                const core = signalCores[i];
                if (core.collected) continue;

                core.group.position.y =
                    core.baseY + Math.sin(coreTime * 2.2 + i * 1.3) * 0.06;
                core.orb.rotation.x += dt * 1.8;
                core.orb.rotation.y += dt * 2.4;
                core.orb.scale.setScalar(1 + Math.sin(coreTime * 4 + i) * 0.08);
                core.light.intensity = 1.1 + Math.sin(coreTime * 3 + i) * 0.45;
            }

            // ============ DUST ============
            const positions = particleGeo.attributes.position
                .array as Float32Array;
            for (let i = 0; i < particleCount; i++) {
                positions[i * 3] += particleVelocities[i * 3];
                positions[i * 3 + 1] += particleVelocities[i * 3 + 1];
                positions[i * 3 + 2] += particleVelocities[i * 3 + 2];
                if (positions[i * 3 + 1] < 0) {
                    positions[i * 3 + 1] = 3;
                    positions[i * 3] = (Math.random() - 0.5) * 30;
                    positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
                }
            }
            particleGeo.attributes.position.needsUpdate = true;
        }

        // Update post-processing uniforms.
        cinematicPass.uniforms.uTime.value = time * 1000;

        // Blood pressure / splatter intensifies when the monster is very close.
        cinematicPass.uniforms.uBloodSplat.value = Math.max(
            0,
            Math.min(0.9, (4 - distToPlayer) / 4),
        );

        // Extra cinematic vignette tied to monster proximity.
        // In B mode, keep the picture clearer for recording.
        const baseVignette = brightMode ? 0.85 : 0.55;
        const proximityBoost = monster.visible
            ? Math.max(0, (5 - distToPlayer) / 5) * (brightMode ? 0.6 : 0.35)
            : 0;
        cinematicPass.uniforms.uVignette.value = baseVignette + proximityBoost;

        // Render through post-processing composer.
        composer.render();
        requestAnimationFrame(animate);
    }

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();

        const pixelRatio = Math.min(window.devicePixelRatio, pixelRatioCap);

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(pixelRatio);

        composer.setSize(window.innerWidth, window.innerHeight);
        composer.setPixelRatio(pixelRatio);
        bloomPass.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
