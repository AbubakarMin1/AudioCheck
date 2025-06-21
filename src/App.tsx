import { useState, useEffect, useRef } from 'react';
import './App.css';

interface HealthCheckResponse {
  status: string
  timestamp: string
  openai_configured: boolean
}

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [response, setResponse] = useState<string>("")
  const [healthStatus, setHealthStatus] = useState<HealthCheckResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>("")
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [responseAudio, setResponseAudio] = useState<string>("")
  const [wsConnected, setWsConnected] = useState(false)
  const [isLiveCall, setIsLiveCall] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // Check backend health on component mount
  useEffect(() => {
    checkHealth()
  }, [])

  const checkHealth = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("http://localhost:5000/health")
      const data = await response.json()
      setHealthStatus(data)
      setError("")
    } catch (err) {
      setError("Backend server is not running on port 5000")
      setHealthStatus(null)
    } finally {
      setIsLoading(false)
    }
  }

  const initWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    wsRef.current = new WebSocket("ws://localhost:8080")

    wsRef.current.onopen = () => {
      setResponse("WebSocket connected successfully!")
      setWsConnected(true)
    }

    wsRef.current.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        setResponse(JSON.stringify(data, null, 2))
      } catch {
        setResponse("Received audio response")
        // Handle binary audio data
        const audio = new Audio(URL.createObjectURL(new Blob([event.data], { type: "audio/mp3" })))
        audio.play()
      }
    }

    wsRef.current.onerror = (error: Event) => {
      console.error("WebSocket error:", error)
      setError("WebSocket connection failed")
      setWsConnected(false)
    }

    wsRef.current.onclose = () => {
      setResponse("WebSocket connection closed")
      setWsConnected(false)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" })
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(audioBlob)
        } else {
          setError("WebSocket not connected. Please test WebSocket first.")
        }
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      setError("")
    } catch (error) {
      console.error("Error accessing microphone:", error)
      setError("Could not access microphone. Please check permissions.")
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const testFileUpload = async () => {
    if (!audioFile) {
      setError("Please select an audio file first")
      return
    }

    setIsLoading(true)
    setError("")
    setResponseAudio("") // Clear previous audio

    try {
      const formData = new FormData()
      formData.append("audio", audioFile)

      const response = await fetch("http://localhost:5000/api/voice", {
        method: "POST",
        body: formData,
      })

      if (response.ok) {
        // Create a blob from the audio response
        const audioBlob = await response.blob()
        const audioUrl = URL.createObjectURL(audioBlob)
        setResponseAudio(audioUrl)
        setResponse("Audio response received! Use the player below to listen.")
        setError("")
      } else {
        const errorData = await response.text()
        setError(`Upload failed: ${errorData}`)
      }
    } catch (err) {
      setError(`Upload error: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setAudioFile(file)
      setError("")
    }
  }

  const startLiveCall = async () => {
    try {
      // Check if browser supports getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support audio recording');
      }

      // Request microphone permissions first
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1, // Mono audio for better compatibility
          sampleRate: 16000 // Match Whisper's preferred sample rate
        } 
      }).catch(error => {
        if (error.name === 'NotAllowedError') {
          throw new Error('Microphone access was denied. Please allow microphone access in your browser settings.');
        } else if (error.name === 'NotFoundError') {
          throw new Error('No microphone found. Please connect a microphone and try again.');
        } else {
          throw new Error(`Error accessing microphone: ${error.message}`);
        }
      });

      streamRef.current = stream;
      
      // Initialize WebSocket connection with reconnection logic
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        const connectWebSocket = () => {
          return new Promise<void>((resolve, reject) => {
            const ws = new WebSocket("ws://localhost:8080");
            
            ws.onopen = () => {
              console.log("WebSocket connected");
              wsRef.current = ws;
              setWsConnected(true);
              setResponse("Connected to AI agent. You can start speaking now.");
              setIsLiveCall(true);
              resolve();
            };

            ws.onmessage = async (event: MessageEvent) => {
              try {
                // Handle JSON messages
                if (typeof event.data === 'string') {
                  const data = JSON.parse(event.data);
                  if (data.type === 'error') {
                    setError(data.details || data.error);
                  } else if (data.type === 'connection') {
                    console.log('Connection status:', data.status);
                  }
                  return;
                }

                // Handle binary audio data
                const audioBlob = new Blob([event.data], { type: 'audio/mpeg' });
                const audioUrl = URL.createObjectURL(audioBlob);
                
                const audio = new Audio(audioUrl);
                audio.onended = () => {
                  URL.revokeObjectURL(audioUrl);
                };
                await audio.play();
              } catch (err) {
                console.error('Error handling message:', err);
              }
            };

            ws.onerror = (error: Event) => {
              console.error("WebSocket error:", error);
              reject(new Error("WebSocket connection failed"));
            };

            ws.onclose = (event) => {
              console.log("WebSocket closed:", event.code, event.reason);
              setWsConnected(false);
              if (isLiveCall) {
                // Attempt to reconnect if the call is still active
                setTimeout(() => {
                  if (isLiveCall) {
                    console.log("Attempting to reconnect...");
                    connectWebSocket().catch(console.error);
                  }
                }, 1000);
              }
            };
          });
        };

        await connectWebSocket();
      }

      // Create MediaRecorder with WebM format
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
        audioBitsPerSecond: 16000 // Match Whisper's preferred bitrate
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          // Send the WebM audio data directly
          wsRef.current.send(event.data);
        }
      };

      // Start recording with smaller chunks for more real-time interaction
      mediaRecorder.start(500); // Collect data every 500ms for faster response
      setIsLiveCall(true);
      setError("");
    } catch (error) {
      console.error("Error starting live call:", error);
      setError(error instanceof Error ? error.message : "Could not start live call. Please check permissions.");
      // Clean up any partial setup
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      setIsLiveCall(false);
    }
  };

  const endLiveCall = () => {
    if (mediaRecorderRef.current && isLiveCall) {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    setIsLiveCall(false);
  };

  return (
    <div className="App">
      <div className="header">
        <h1>🎤 Voice AI API Tester</h1>
        <p>Test your backend audio processing APIs</p>
      </div>

      <div className="controls">
        {/* Health Check Section */}
        <div className="api-testing">
          <h3>Backend Health Check</h3>
          <div className="health-check">
            <div className={`status-indicator ${isLoading ? 'loading' : healthStatus ? '' : 'error'}`}></div>
            <span>
              {isLoading ? 'Checking...' : 
               healthStatus ? `Server OK (OpenAI: ${healthStatus.openai_configured ? '✅' : '❌'})` : 
               'Server Offline'}
            </span>
          </div>
          <button className="test-button" onClick={checkHealth} disabled={isLoading}>
            Refresh Health Check
          </button>
        </div>

        {/* Live Call Section */}
        <div className="api-testing">
          <h3>🤖 Live AI Agent Call</h3>
          <p>Talk with our computer parts expert</p>
          <button 
            className={`call-button ${isLiveCall ? 'active' : ''}`}
            onClick={isLiveCall ? endLiveCall : startLiveCall}
            disabled={isLoading}
          >
            {isLiveCall ? '📞 End Call' : '📞 Start Live Call'}
          </button>
          {isLiveCall && (
            <div className="call-status">
              <div className={`status-indicator ${wsConnected ? 'connected' : 'disconnected'}`}></div>
              <span>{wsConnected ? 'Connected' : 'Connecting...'}</span>
            </div>
          )}
        </div>

        {/* File Upload Test */}
        <div className="api-testing">
          <h3>File Upload API Test</h3>
          <div className="file-upload">
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="file-input"
              id="audio-file"
            />
            <label htmlFor="audio-file" className="file-label">
              {audioFile ? audioFile.name : 'Choose Audio File'}
            </label>
          </div>
          <button 
            className="test-button" 
            onClick={testFileUpload} 
            disabled={!audioFile || isLoading}
          >
            {isLoading ? 'Processing...' : 'Test File Upload'}
          </button>
          
          {responseAudio && (
            <div className="audio-player-container">
              <audio 
                controls 
                className="audio-player" 
                src={responseAudio}
                style={{ width: '100%', marginTop: '1rem' }}
              >
                Your browser does not support the audio element.
              </audio>
            </div>
          )}
        </div>
      </div>

      {/* Response Section */}
      {(response || error) && (
        <div className="response-section">
          <h3>Response</h3>
          {error && <div className="error">{error}</div>}
          {response && <div className="response-box">{response}</div>}
        </div>
      )}

      {/* Health Status Details */}
      {healthStatus && (
        <div className="response-section">
          <h3>Server Details</h3>
          <div className="response-box">
            {JSON.stringify(healthStatus, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
