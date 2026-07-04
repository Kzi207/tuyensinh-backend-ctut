const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON parser for body
app.use(express.json());

// Enable CORS for standalone frontend access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Load the System Prompt from prompt.txt
let systemPrompt = '';
const promptPath = path.join(__dirname, 'prompt.txt');

try {
  if (fs.existsSync(promptPath)) {
    // Read the prompt file and remove line numbers if they were added (e.g. "1: Dưới đây là...")
    const rawPrompt = fs.readFileSync(promptPath, 'utf8');
    
    // Clean up lines that start with "<number>: " (like IDE output)
    systemPrompt = rawPrompt
      .split('\n')
      .map(line => {
        const match = line.match(/^\d+:\s?(.*)$/);
        return match ? match[1] : line;
      })
      .join('\n');
      
    console.log('✅ Loaded system prompt from prompt.txt successfully!');
  } else {
    console.warn('⚠️ prompt.txt not found. Running without pre-loaded system instructions.');
  }
} catch (error) {
  console.error('❌ Error reading prompt.txt:', error.message);
}

// Endpoint to get server configuration status (e.g., if API key is set)
app.get('/api/config', (req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE';
  res.json({
    hasServerApiKey: hasKey,
    defaultModel: process.env.DEFAULT_MODEL || 'gemma-4-31b-it',
    fastModel: process.env.FAST_MODEL || 'gemini-2.5-flash'
  });
});

// Primary route to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Proxy endpoint for calling the Gemini/Gemma API
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, mode } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    // Determine the API Key (always configured on the server)
    let apiKey = process.env.GEMINI_API_KEY;
    if (apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      apiKey = '';
    }

    if (!apiKey) {
      return res.status(400).json({
        error: 'API Key is missing. Please configure GEMINI_API_KEY in the server\'s .env file.'
      });
    }

    // Determine the model (always configured on the server)
    let selectedModel = process.env.DEFAULT_MODEL || 'gemma-4-31b-it';
    if (mode === 'fast') {
      selectedModel = process.env.FAST_MODEL || 'gemini-2.5-flash';
    }
    const modelPath = selectedModel.startsWith('models/') ? selectedModel : `models/${selectedModel}`;

    // Prepare API URL
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:streamGenerateContent?key=${apiKey}&alt=sse`;

    // Format the payload for Google Generative Language API
    // The messages array from frontend should be formatted as:
    // [ { role: 'user'|'model', parts: [ { text: '...' } ] } ]
    const payload = {
      contents: messages,
      generationConfig: {
        temperature: 0.3,
        topP: 0.95,
        maxOutputTokens: 8192
      }
    };

    // Safely configure thinkingBudget for Gemini 2.5 models that support it
    if (selectedModel.includes('gemini-2.5')) {
      payload.generationConfig.thinkingConfig = {
        thinkingBudget: mode === 'fast' ? 0 : 2048
      };
    }



    // Attach system prompt if loaded
    if (systemPrompt) {
      payload.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    console.log(`🤖 Sending request to Google API using model (streaming): ${modelPath}`);

    // Call Google's API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Google API Error details:', errorData);
      return res.status(response.status).json({
        error: errorData.error?.message || 'Google API request failed.',
        details: errorData
      });
    }

    // Set SSE headers for the client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response directly to the client
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (err) {
      console.error('❌ Error during response stream forwarding:', err);
    } finally {
      res.end();
    }

  } catch (error) {
    console.error('❌ Server error processing request:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// Start the server (watch reload v5)
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 CTUT 2026 AI Admission Advisor is running!`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
