import { useState, useEffect, useRef } from 'react';
import './App.css';

interface HealthCheckResponse {
  status: string;
  timestamp: string;
  openai_configured: boolean;
}

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [response, setResponse] = useState<string>('');
  const [healthStatus, setHealthStatus] = useState<HealthCheckResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [responseAudio, setResponseAudio] = useState<string>('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Check backend health on component mount
  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('http://localhost:5000/health');
      const data = await response.json();
      setHealthStatus(data);
      setError('');
    } catch (err) {
      setError('Backend server is not running on port 5000');
      setHealthStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  const initWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    wsRef.current = new WebSocket('ws://localhost:8080');

    wsRef.current.onopen = () => {
      setResponse('WebSocket connected successfully!');
    };

    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setResponse(JSON.stringify(data, null, 2));
      } catch {
        setResponse('Received audio response');
        // Handle binary audio data
        const audio = new Audio(URL.createObjectURL(new Blob([event.data], { type: 'audio/mp3' })));
        audio.play();
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection failed');
    };

    wsRef.current.onclose = () => {
      setResponse('WebSocket connection closed');
    };
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(audioBlob);
        } else {
          setError('WebSocket not connected. Please test WebSocket first.');
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError('');
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setError('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const testFileUpload = async () => {
    if (!audioFile) {
      setError('Please select an audio file first');
      return;
    }

    setIsLoading(true);
    setError('');
    
    try {
      const formData = new FormData();
      formData.append('audio', audioFile);

      const response = await fetch('http://localhost:5000/api/voice', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        setResponseAudio(audioUrl);
        setResponse('Audio file processed successfully! Check the audio player below.');
      } else {
        const errorData = await response.text();
        setError(`Upload failed: ${errorData}`);
      }
    } catch (err) {
      setError(`Upload error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAudioFile(file);
      setError('');
    }
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
            <audio controls className="audio-player" src={responseAudio}>
              Your browser does not support the audio element.
            </audio>
          )}
        </div>

        {/* WebSocket Test */}
        <div className="api-testing">
          <h3>WebSocket Real-time Test</h3>
          <button className="test-button" onClick={initWebSocket}>
            Connect WebSocket
          </button>
        </div>

        {/* Live Recording Section */}
        <div className="recording-section">
          <h3>🔴 Live Recording Test</h3>
          <p>Record audio and send via WebSocket</p>
          <button 
            className={`record-button ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? '⏹️ Stop Recording' : '🎙️ Start Recording'}
          </button>
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