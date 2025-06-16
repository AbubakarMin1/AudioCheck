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
dotenv.config({ path: path.join(__dirname, '.env') });

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
const upload = multer({ dest: path.join(__dirname, 'uploads/') });

// Ensure uploads directory exists
// Reason: Multer needs a directory to store uploaded files.
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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
      // For now, just echo back a simple response
      ws.send(JSON.stringify({ message: 'Audio received and processed' }));
    } catch (error) {
      console.error('Error processing audio:', error);
      ws.send(JSON.stringify({ error: 'Error processing audio.' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    openai_configured: !!process.env.OPENAI_API_KEY
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

    // Call the OpenAI transcription API first
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: 'whisper-1',
    });

    // Generate a response using GPT
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: transcription.text,
        },
      ],
    });

    // Generate speech from the response
    const speechResponse = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy',
      input: chatResponse.choices[0].message.content || 'Sorry, I could not process that.',
    });

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    // Convert response to buffer and send as audio
    const buffer = Buffer.from(await speechResponse.arrayBuffer());
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length.toString(),
    });
    res.send(buffer);
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
