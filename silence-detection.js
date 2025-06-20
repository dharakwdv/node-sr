const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");

// CONFIG
const CHUNK_SIZE = 3200; // 100ms for 16kHz mono 16-bit
const SILENCE_THRESHOLD = 400;
const SILENT_CHUNKS_LIMIT = 15; // ~1.5s silence
const FILE_PATH = "test_audio.wav";
const OUTPUT_FILE = "transcript.txt";
const STREAM_INTERVAL_MS = 100;
const wsURL = `ws://147.185.246.115:80/api-speech-wss/?output_format=json&output_native=true&not_use_prompt=true&denoise=true&normalize=true&dynamic_language_detection=false&lang=en&no_speech_threshold=0.4&scores_threshold=0.7&vad_min_speech_threshold=0.3&beam_size=3&temperatures=0.2`;

// INIT
let silentChunks = 0;
let bufferOffset = 0;
let audioBuffer = fs.readFileSync(FILE_PATH);
let ws;
let isStreaming = false;

// Clear previous transcript
fs.writeFileSync(OUTPUT_FILE, "");

function createNewSocket() {
  ws = new WebSocket(wsURL);

  ws.on("open", () => {
    console.log("Socket opened");
    isStreaming = true;
    startStreaming();
  });

  ws.on("close", () => {
    console.log("Socket closed");
    isStreaming = false;
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    isStreaming = false;
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      console.log("Received message:", message);
      const results = message?.result;

      if (results && Array.isArray(results)) {
        const finalSegments = results.filter((r) => r.is_final && r.text.trim());
        for (const segment of finalSegments) {
          fs.appendFileSync(OUTPUT_FILE, segment.text.trim() + "\n");
          console.log("Final:", segment.text);
        }
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });
}

function isSilent(chunk) {
  const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
  return samples.every((s) => Math.abs(s) < SILENCE_THRESHOLD);
}

function startStreaming() {
  const interval = setInterval(() => {
    if (!isStreaming || !ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("⏸️ WebSocket not ready, stopping stream...");
      clearInterval(interval);
      return;
    }

    // End of audio file
    if (bufferOffset >= audioBuffer.length) {
      console.log("Finished streaming file");
      clearInterval(interval);
      return;
    }

    const chunk = audioBuffer.slice(bufferOffset, bufferOffset + CHUNK_SIZE);
    bufferOffset += CHUNK_SIZE;

    try {
      if (isSilent(chunk)) {
        silentChunks++;
        console.log(`Silent chunk ${silentChunks}/${SILENT_CHUNKS_LIMIT}`);

        if (silentChunks >= SILENT_CHUNKS_LIMIT) {
          console.log("Silence threshold met — sending reset");
          ws.send("reset");
          silentChunks = 0;
        }
      } else {
        silentChunks = 0;
        ws.send(chunk);
      }
    } catch (err) {
      console.error("Error during chunk send:", err);
    }
  }, STREAM_INTERVAL_MS);
}

// Start
createNewSocket();
