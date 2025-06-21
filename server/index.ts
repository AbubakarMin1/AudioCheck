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
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

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
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads/'),
  filename: (req, file, cb) => {
    // Preserve the original file extension
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});

const upload = multer({ storage });

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

// System prompt for the AI agent
const SYSTEM_PROMPT = `You are an expert computer parts sales agent with deep knowledge of current PC components, their features, and market prices. Your role is to:
1. Help customers find the best components for their needs and budget
2. Provide accurate, up-to-date information about:
   - Graphics cards (NVIDIA, AMD)
   - CPUs (Intel, AMD)
   - Motherboards
   - RAM
   - Storage solutions
   - Power supplies
   - Cases
3. Compare different options and explain trade-offs
4. Stay professional but friendly
5. Ask clarifying questions when needed
6. Provide specific model recommendations with current prices
7. Explain technical terms in simple language

Current market context (as of 2024):
- High-end GPUs: RTX 4090 ($1600-2000), RTX 4080 ($1000-1200), RX 7900 XTX ($900-1000)
- Mid-range GPUs: RTX 4070 ($500-600), RX 7700 XT ($400-450)
- Entry-level GPUs: RTX 4060 ($300-350), RX 7600 ($250-300)
- High-end CPUs: i9-14900K ($550-600), Ryzen 9 7950X ($500-550)
- Mid-range CPUs: i7-14700K ($350-400), Ryzen 7 7700X ($300-350)
- Entry-level CPUs: i5-14600K ($250-300), Ryzen 5 7600X ($200-250)

Remember to:
- Always verify customer's budget first
- Consider compatibility between components
- Mention warranty and support options
- Suggest complete builds when appropriate
- Stay updated with the latest releases and price changes`;

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Create a WebSocket server
const wss = new WebSocketServer({ 
  port: 8080,
  // Add ping/pong to keep connection alive
  clientTracking: true,
  perMessageDeflate: false
});

// Keep track of active connections
const activeConnections = new Map();

// Add this function before the WebSocket handler
const convertWebmToWav = (inputPath: string, outputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
};

wss.on('connection', (ws) => {
  console.log('Client connected');
  const connectionId = Date.now().toString();
  activeConnections.set(connectionId, ws);
  
  let conversationHistory: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT }
  ];

  // Send initial connection success message
  ws.send(JSON.stringify({ type: 'connection', status: 'connected' }));

  // Handle ping/pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

  ws.on('pong', () => {
    console.log('Received pong from client');
  });

  ws.on('message', async (message) => {
    try {
      if (!(message instanceof Buffer)) {
        console.error('Received non-buffer message');
        return;
      }

      // Create temporary files for WebM and WAV
      const webmPath = path.join(uploadsDir, `temp_${Date.now()}.webm`);
      const wavPath = path.join(uploadsDir, `temp_${Date.now()}.wav`);
      
      // Save the WebM data
      fs.writeFileSync(webmPath, message);

      // Convert WebM to WAV with proper format
      await convertWebmToWav(webmPath, wavPath);

      // Convert the audio message to text using Whisper with optimized settings
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(wavPath),
        model: 'whisper-1',
        response_format: 'text',
        temperature: 0.2,
        language: 'en',
        prompt: "This is a conversation with a computer parts sales agent. The user is asking about PC components, prices, and recommendations."
      });

      // Clean up temporary files
      fs.unlinkSync(webmPath);
      fs.unlinkSync(wavPath);

      // Add user's message to conversation history
      conversationHistory.push({ role: 'user', content: transcription });

      // Get response from GPT-4 with optimized parameters for faster response
      const chatResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: conversationHistory,
        temperature: 0.7,
        max_tokens: 100, // Keep responses concise for faster interaction
        presence_penalty: 0.6,
        frequency_penalty: 0.3
      });

      const aiResponse = chatResponse.choices[0].message.content || 'I apologize, but I could not generate a response.';
      
      // Add AI's response to conversation history
      conversationHistory.push({ role: 'assistant', content: aiResponse });

      // Convert AI's text response to speech with optimized parameters
      const speechResponse = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: aiResponse,
        speed: 1.1, // Slightly faster speech for more natural conversation
        response_format: 'mp3' // Use MP3 for better compatibility
      });

      // Convert speech to buffer and send back
      const buffer = Buffer.from(await speechResponse.arrayBuffer());
      ws.send(buffer);

    } catch (error) {
      console.error('Error processing audio:', error);
      // Send a more detailed error message
      ws.send(JSON.stringify({ 
        type: 'error',
        error: 'Error processing audio.',
        details: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clearInterval(pingInterval);
    activeConnections.delete(connectionId);
  });
});

// Handle server errors
wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
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
    // First transcribe the audio using Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: 'whisper-1'
    });

    // Then get a response from GPT-4
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: transcription.text
        }
      ]
    });

    // Convert the text response to speech
    const speechResponse = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy',
      input: chatResponse.choices[0].message.content || 'Sorry, I could not process that.'
    });

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    // Convert the speech response to buffer
    const buffer = Buffer.from(await speechResponse.arrayBuffer());

    // Set appropriate headers for audio response
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length.toString()
    });

    // Send the audio buffer
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
