const WebSocket = require('ws');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

// === CONFIGURATION ===
const AUDIO_FILE = './test.wav';
const LANGUAGE = 'en';
const OUTPUT_FORMAT = 'text';
const CHUNK_SIZE = 640; // 20ms of audio at 16kHz 16-bit mono
const CHUNK_DURATION_MS = 20;


const wsURL = `ws://147.185.246.115:80/api-speech-wss/?output_format=json&output_native=true&not_use_prompt=true&denoise=true&normalize=true&dynamic_language_detection=false&lang=en&no_speech_threshold=0.2&scores_threshold=0.4&vad_min_speech_threshold=0.4&beam_size=3&temperatures=0.2`;

const outputFilePath = path.join(__dirname, 'recognition_output.txt');

console.log(`Connecting to ${wsURL}`);
const ws = new WebSocket(wsURL, { perMessageDeflate: false });

ws.on('open', () => {
  console.log('WebSocket connected. Converting and chunking audio...');

  const rawAudioBuffer = [];

  const ffmpegStream = ffmpeg(AUDIO_FILE)
    .audioFrequency(16000)
    .audioChannels(1)
    .audioCodec('pcm_s16le')
    .format('s16le')
    .on('error', err => {
      console.error('FFmpeg error:', err.message);
    })
    .pipe();

  ffmpegStream.on('data', chunk => {
    rawAudioBuffer.push(chunk);
  });

  ffmpegStream.on('end', () => {
    const fullBuffer = Buffer.concat(rawAudioBuffer);
    console.log('Audio conversion complete. Total size:', fullBuffer.length);

    const chunks = [];
    let offset = 0;
    while (offset + CHUNK_SIZE <= fullBuffer.length) {
      const slice = fullBuffer.slice(offset, offset + CHUNK_SIZE);
      chunks.push(slice);
      offset += CHUNK_SIZE;
    }

    console.log(`Prepared ${chunks.length} audio chunks.`);
    streamAudioChunks(chunks, { fastMode: true }); 
  });

function streamAudioChunks(chunks, options = { fastMode: false }) {
  let index = 0;

  function sendChunk() {
    if (ws.readyState !== WebSocket.OPEN) return;

    if (index < chunks.length) {
      const chunk = chunks[index];
      ws.send(chunk);
      console.log(`Sent chunk ${index + 1}/${chunks.length} (size: ${chunk.length})`);
      index++;

      const delay = options.fastMode ? 1 : CHUNK_DURATION_MS;
      setTimeout(sendChunk, delay);
    } else {
      console.log('All audio chunks sent. Closing WebSocket in 2s...');
      setTimeout(() => ws.close(), 2000);
    }
  }

  sendChunk();
}

});

ws.on('message', msg => {
  console.clear();
  const result = msg.toString();
  console.log('Recognition result:\n', result);

  fs.appendFile(outputFilePath, result + '\n', err => {
    if (err) console.error('Failed to write to file:', err);
  });
});

ws.on('close', () => {
  console.log('WebSocket closed.');
});

ws.on('error', err => {
  console.error('WebSocket error:', err);
});
