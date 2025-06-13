import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
// Reason: We need to securely access the OpenAI API key without hardcoding it.
dotenv.config();

// Create an instance of Express
// Reason: This is the main app object for our backend server.
const app = express();

// Use CORS to allow requests from the frontend
// Reason: The frontend (React app) will be served from a different port during development.
app.use(cors());

// Middleware to parse JSON bodies
// Reason: We'll accept JSON requests from the frontend.
app.use(express.json());

// Configure multer for audio file uploads
// Reason: We need to handle audio file uploads from the frontend.
const upload = multer({ dest: 'uploads/' });

// Initialize OpenAI client
// Reason: We need to interact with the OpenAI API for the GPT-4o audio agent.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a WebSocket server
// Reason: We need real-time, bidirectional communication for audio streaming.
const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    try {
      // Assume the message is an audio chunk (Buffer)
      const audioChunk = message as Buffer;

      // Call the OpenAI API with the audio chunk
      const response = await openai.audio.speech.create({
        model: 'gpt-4o-audio-preview',
        input: audioChunk.toString('base64'),
        voice: 'alloy',
        response_format: 'mp3',
      });

      // Convert response to Buffer and send it back to the client
      const buffer = Buffer.from(await response.arrayBuffer());
      ws.send(buffer);
    } catch (error) {
      console.error('Error processing audio:', error);
      ws.send(JSON.stringify({ error: 'Error processing audio.' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Endpoint for voice AI agent interaction
// Reason: This endpoint will receive an audio file, process it, and return the response from the OpenAI GPT-4o audio agent.
app.post('/api/voice', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No audio file uploaded.' });
    return;
  }

  try {
    // Read the uploaded audio file
    const audioFile = fs.readFileSync(req.file.path);

    // Call the OpenAI API with the audio file
    const response = await openai.audio.speech.create({
      model: 'gpt-4o-audio-preview',
      input: audioFile.toString('base64'),
      voice: 'alloy',
      response_format: 'mp3',
    });

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    // Return the response from the OpenAI API
    res.json(response);
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).json({ error: 'Error processing audio.' });
  }
});

// Start the server
// Reason: We need to listen on a port for incoming requests.
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
