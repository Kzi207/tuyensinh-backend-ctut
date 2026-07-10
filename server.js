const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const scoreConverter = require('./scoreConverter');


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
    fastModel: process.env.FAST_MODEL || 'gemma-4-31b-it'
  });
});

// Primary route to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Classifier to check if the user's latest query is about score conversion.
 */
async function classifyQuery(userQuery, apiKey) {
  const prompt = `You are a classification assistant. Your task is to detect if the user's latest message in a Vietnamese conversation is asking to calculate or convert their admission scores (either from "Học bạ"/Academic Records/School Records or from "V-SAT" exam/kỳ thi đánh giá năng lực chuyên biệt V-SAT) to the THPT (high school graduation exam) scale.

Analyze the user's query: "${userQuery.replace(/"/g, '\\"')}" and output a JSON response in the following format:
{
  "is_conversion": true | false,
  "type": "hoc_ba" | "vsat" | null,
  "scores": {
    "tohop": number | null, 
    "type": "hoc_ba" | "ket_hop" | null,
    "subjects": {
      "toan": number | null,
      "vat_ly": number | null,
      "hoa_hoc": number | null,
      "sinh_hoc": number | null,
      "lich_su": number | null,
      "dia_ly": number | null,
      "tieng_anh": number | null,
      "ngu_van": number | null,
      "gdcd": number | null,
      "tin_hoc": number | null,
      "cong_nghe": number | null
    }
  }
}

Rules:
1. "is_conversion" must be true ONLY if the user is asking to convert or calculate points/scores. If they are just asking a general question (e.g. standard benchmarks, list of majors, registration dates, how many points are needed to pass), set "is_conversion" to false.
2. If "is_conversion" is true:
   - Identify if it is "hoc_ba" (academic records/học bạ) or "vsat" (V-SAT exam score).
   - Extract the numeric scores. Keep them as float/integers.
   - Map the subjects mentioned to their corresponding keys in "subjects" (Tiếng Anh -> tieng_anh, Toán -> toan, Vật lí/Vật lý -> vat_ly, Hóa học -> hoa_hoc, Sinh học -> sinh_hoc, Lịch sử -> lich_su, Địa lí/Địa lý -> dia_ly, Ngữ văn/Văn -> ngu_van, GDCD -> gdcd, Tin học -> tin_hoc, Công nghệ/CNCN -> cong_nghe).
   - If they provide a combined score for học bạ, set "tohop" (e.g., 27.5) and specify "type" as "hoc_ba" (for normal học bạ) or "ket_hop" (if they say "kết hợp" or "học bạ kết hợp"). If they don't specify, default "type" to "hoc_ba".
   - If they provide individual subject scores for học bạ (e.g., "môn toán 9, hóa 9, vật lý 9"), extract them into the "subjects" object, calculate their sum and set it in "tohop".

Few-shot Examples:
Example 1: "Đổi hộ mình điểm học bạ 28.2 sang thpt với"
Output:
{"is_conversion": true, "type": "hoc_ba", "scores": {"tohop": 28.2, "type": "hoc_ba", "subjects": null}}

Example 2: "môn toán 9 , hóa 9 , vật lý 9 , tính học bạ"
Output:
{"is_conversion": true, "type": "hoc_ba", "scores": {"tohop": 27.0, "type": "hoc_ba", "subjects": {"toan": 9.0, "hoa_hoc": 9.0, "vat_ly": 9.0}}}

Example 3: "quy đổi điểm vsat toán 120 lý 115 hóa 130"
Output:
{"is_conversion": true, "type": "vsat", "scores": {"tohop": null, "type": null, "subjects": {"toan": 120.0, "vat_ly": 115.0, "hoa_hoc": 130.0}}}

Example 4: "Năm nay trường tuyển sinh những ngành nào?"
Output:
{"is_conversion": false, "type": null, "scores": null}

Respond ONLY with the JSON block. Do not include any markdown format or explanations outside the JSON.`;

function parseClassifierResponse(text) {
  if (!text) return { is_conversion: false };
  
  let cleanText = text.trim();
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.substring(7);
  }
  if (cleanText.endsWith('```')) {
    cleanText = cleanText.substring(0, cleanText.length - 3);
  }
  cleanText = cleanText.trim();
  
  function normalize(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      return { is_conversion: false };
    }
    if ('is_conversion' in parsed) {
      parsed.is_conversion = !!parsed.is_conversion;
    } else {
      parsed.is_conversion = false;
    }
    if (parsed.is_conversion) {
      if (!parsed.scores || typeof parsed.scores !== 'object') {
        parsed.scores = {
          tohop: parsed.tohop !== undefined ? parsed.tohop : null,
          type: parsed.type !== undefined ? parsed.type : null,
          subjects: parsed.subjects !== undefined ? parsed.subjects : null
        };
      }
    }
    return parsed;
  }
  
  // Try direct parsing
  try {
    return normalize(JSON.parse(cleanText));
  } catch (e) {}
  
  // Search for any valid JSON object that contains is_conversion
  const regex = /\{[\s\S]*?\}/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === 'object') {
        if ('is_conversion' in parsed || /is_conversion/i.test(match[0])) {
          return normalize(parsed);
        }
      }
    } catch (e) {}
  }
  
  // Try matching the last JSON-like block
  try {
    const lastBraceStart = text.lastIndexOf('{');
    const lastBraceEnd = text.lastIndexOf('}');
    if (lastBraceStart !== -1 && lastBraceEnd !== -1 && lastBraceEnd > lastBraceStart) {
      const potentialJson = text.substring(lastBraceStart, lastBraceEnd + 1);
      const parsed = JSON.parse(potentialJson);
      if (parsed && typeof parsed === 'object') {
        if (!('is_conversion' in parsed)) {
          parsed.is_conversion = /is_conversion["'`]?\s*:\s*["'`]?true/i.test(text);
        }
        if (!('type' in parsed)) {
          const typeMatch = text.match(/type["'`]?\s*:\s*["'`]?(hoc_ba|vsat)/i);
          if (typeMatch) {
            parsed.type = typeMatch[1].toLowerCase();
          }
        }
        return normalize(parsed);
      }
    }
  } catch (e) {}
  
  // Direct regex fallback for fields if JSON parsing completely failed
  const isConversion = /is_conversion["'`]?\s*:\s*["'`]?true/i.test(text);
  if (isConversion) {
    const typeMatch = text.match(/type["'`]?\s*:\s*["'`]?(hoc_ba|vsat)/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : (text.includes('hoc_ba') ? 'hoc_ba' : (text.includes('vsat') ? 'vsat' : null));
    
    let tohop = null;
    const tohopMatch = text.match(/"tohop":\s*([0-9.]+)/) || text.match(/tohop:\s*([0-9.]+)/);
    if (tohopMatch) tohop = parseFloat(tohopMatch[1]);
    
    // Extract subject scores via regex
    const subjects = {};
    let hasSubjects = false;
    const subMatches = {
      toan: /toan["'`]?\s*:\s*([0-9.]+)/i,
      vat_ly: /vat_ly["'`]?\s*:\s*([0-9.]+)/i,
      hoa_hoc: /hoa_hoc["'`]?\s*:\s*([0-9.]+)/i,
      sinh_hoc: /sinh_hoc["'`]?\s*:\s*([0-9.]+)/i,
      lich_su: /lich_su["'`]?\s*:\s*([0-9.]+)/i,
      dia_ly: /dia_ly["'`]?\s*:\s*([0-9.]+)/i,
      tieng_anh: /tieng_anh["'`]?\s*:\s*([0-9.]+)/i,
      ngu_van: /ngu_van["'`]?\s*:\s*([0-9.]+)/i,
      gdcd: /gdcd["'`]?\s*:\s*([0-9.]+)/i,
      tin_hoc: /tin_hoc["'`]?\s*:\s*([0-9.]+)/i,
      cong_nghe: /cong_nghe["'`]?\s*:\s*([0-9.]+)/i
    };
    
    for (const [key, pat] of Object.entries(subMatches)) {
      const match = text.match(pat);
      if (match) {
        subjects[key] = parseFloat(match[1]);
        hasSubjects = true;
      }
    }
    
    return {
      is_conversion: true,
      type: type,
      scores: {
        tohop: tohop,
        type: type,
        subjects: hasSubjects ? subjects : null
      }
    };
  }
  
  return { is_conversion: false };
}

  const modelsToTry = [
    process.env.FAST_MODEL || 'gemini-2.5-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash-exp'
  ];
  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      console.log(`🤖 Classifier trying model: ${model}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log(`🤖 Classifier model ${model} raw text:`, text);
        if (text) {
          const parsed = parseClassifierResponse(text);
          return parsed;
        }
      } else {
        const errText = await res.text();
        console.warn(`⚠️ Classifier model ${model} returned non-ok status ${res.status}:`, errText);
      }
    } catch (e) {
      console.warn(`⚠️ Classifier failed with model ${model}:`, e.message);
    }
  }
  
  // Non-JSON fallback try
  try {
    const fallbackModel = process.env.FAST_MODEL || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`;
    console.log(`🤖 Classifier fallback trying model: ${fallbackModel}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log(`🤖 Classifier fallback raw text:`, text);
      if (text) {
        return parseClassifierResponse(text);
      }
    } else {
      const errText = await res.text();
      console.warn(`⚠️ Classifier fallback returned non-ok status ${res.status}:`, errText);
    }
  } catch (e) {
    console.error('❌ Classifier fallback failed:', e.message);
  }
  
  return { is_conversion: false };
}

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

    // Classify user query for point conversion
    const userMessages = messages.filter(m => m.role === 'user');
    const latestMessage = userMessages[userMessages.length - 1]?.parts?.[0]?.text || '';
    
    let classification = { is_conversion: false };
    if (latestMessage) {
      try {
        classification = await classifyQuery(latestMessage, apiKey);
        console.log('🔍 Query Classification:', JSON.stringify(classification));
      } catch (err) {
        console.error('❌ Error during query classification:', err.message);
      }
    }

    if (classification && classification.is_conversion) {
      let replyText = '';
      
      if (classification.type === 'hoc_ba') {
        let tohop = classification.scores?.tohop;
        const rawSubjects = classification.scores?.subjects || {};
        const subjects = {};
        let subSum = 0;
        let hasSubjects = false;
        
        for (const sub of Object.keys(rawSubjects)) {
          if (rawSubjects[sub] !== null && rawSubjects[sub] !== undefined && !isNaN(rawSubjects[sub])) {
            subjects[sub] = parseFloat(rawSubjects[sub]);
            subSum += subjects[sub];
            hasSubjects = true;
          }
        }
        
        // Recalculate tohop on server logic to guarantee 100% mathematical correctness
        if (hasSubjects) {
          tohop = subSum;
        }
        
        if (tohop !== null && tohop !== undefined && !isNaN(tohop)) {
          let combinationCode = null;
          if (hasSubjects) {
            const keys = Object.keys(subjects);
            const combo = scoreConverter.findCombination(keys);
            if (combo) {
              combinationCode = combo.code;
            }
          }
          
          const result = scoreConverter.convertHocBa(tohop, classification.scores.type || 'hoc_ba', hasSubjects ? subjects : null, combinationCode);
          if (result.error) {
            replyText = `❌ **Lỗi:** ${result.error}`;
          } else {
            replyText = result.explanation;
          }
        } else {
          replyText = `⚠️ **Vui lòng cung cấp điểm tổ hợp học bạ** (ví dụ: "môn toán 9, hóa 9, lý 9" hoặc "điểm học bạ của mình là 27.5") để mình có thể tính điểm quy đổi chính xác cho bạn nhé.`;
        }
      } else if (classification.type === 'vsat') {
        const subjects = {};
        const rawSubjects = classification.scores?.subjects || {};
        for (const sub of Object.keys(rawSubjects)) {
          if (rawSubjects[sub] !== null && rawSubjects[sub] !== undefined) {
            subjects[sub] = rawSubjects[sub];
          }
        }
        
        if (Object.keys(subjects).length > 0) {
          const result = scoreConverter.convertVsat(subjects);
          if (result.error) {
            replyText = `❌ **Lỗi:** ${result.error}`;
          } else {
            replyText = result.explanation;
          }
        } else {
          replyText = `⚠️ **Vui lòng cung cấp điểm thi V-SAT của các môn học** (ví dụ: "Toán 120, Lý 115") để mình quy đổi điểm sang thang 30 cho bạn nhé.`;
        }
      } else {
        replyText = `⚠️ **Không nhận diện được yêu cầu tính điểm.** Vui lòng nhập rõ điểm học bạ hoặc điểm V-SAT để quy đổi (ví dụ: "đổi điểm học bạ 27.5" hoặc "quy đổi điểm V-SAT Toán 120").`;
      }
      
      // Stream calculated response to frontend
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const chunkSize = 25;
      const chunks = [];
      for (let i = 0; i < replyText.length; i += chunkSize) {
        chunks.push(replyText.slice(i, i + chunkSize));
      }
      
      for (const chunk of chunks) {
        const sseData = {
          candidates: [{
            content: {
              parts: [{ text: chunk }]
            }
          }]
        };
        res.write(`data: ${JSON.stringify(sseData)}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      res.end();
      return;
    }

    // Determine the model (always configured on the server)
    let selectedModel = process.env.DEFAULT_MODEL || 'gemma-4-31b-it';
    if (mode === 'fast') {
      selectedModel = process.env.FAST_MODEL || 'gemma-4-31b-it';
    }
    const modelPath = selectedModel.startsWith('models/') ? selectedModel : `models/${selectedModel}`;

    // Prepare API URL
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:streamGenerateContent?key=${apiKey}&alt=sse`;

    // Format the payload for Google Generative Language API
    // The messages array from frontend should be formatted as:
    // Prepare contents
    let contents = JSON.parse(JSON.stringify(messages)); // deep copy

    // Prepend system prompt to user message if model is Gemma 4 to avoid 500 Internal Error bug in Google API
    if (systemPrompt) {
      if (selectedModel.includes('gemma-4')) {
        const firstUserMsg = contents.find(msg => msg.role === 'user');
        if (firstUserMsg) {
          if (!firstUserMsg.parts) firstUserMsg.parts = [];
          firstUserMsg.parts.unshift({
            text: `SYSTEM INSTRUCTIONS (strictly follow these instructions):\n${systemPrompt}`
          });
        }
      }
    }

    const payload = {
      contents: contents,
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

    // Attach system prompt officially if loaded and not Gemma 4 (which prepended it)
    if (systemPrompt && !selectedModel.includes('gemma-4')) {
      payload.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    let response;
    let currentModel = selectedModel;
    let currentApiUrl = apiUrl;
    let currentPayload = payload;

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      // 15 seconds timeout to prevent hanging on unstable API connections
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        console.log(`🤖 [Attempt ${attempt + 1}] Sending request to Google API using model (streaming): ${currentModel}`);
        
        response = await fetch(currentApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(currentPayload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          break; // Success!
        }

        // Try to read error body if available
        const errorData = await response.json().catch(() => ({}));
        console.error(`❌ [Attempt ${attempt + 1}] Google API Error (${response.status}):`, errorData);

        if (attempt < maxRetries) {
          console.warn(`⚠️ Retrying in 500ms...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // Fallback if current model is gemma-4
          if (currentModel.includes('gemma-4')) {
            console.warn(`🚨 Gemma-4 failed after ${maxRetries + 1} attempts. Falling back to gemini-2.5-flash for reliability.`);
            currentModel = 'gemini-2.5-flash';
            currentApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:streamGenerateContent?key=${apiKey}&alt=sse`;
            
            // Re-build payload for Gemini 2.5
            const cleanContents = JSON.parse(JSON.stringify(messages));
            currentPayload = {
              contents: cleanContents,
              generationConfig: {
                temperature: 0.3,
                topP: 0.95,
                maxOutputTokens: 8192,
                thinkingConfig: {
                  thinkingBudget: mode === 'fast' ? 0 : 2048
                }
              }
            };
            if (systemPrompt) {
              currentPayload.systemInstruction = {
                parts: [{ text: systemPrompt }]
              };
            }
            // Reset attempts for fallback model
            attempt = -1;
          } else {
            return res.status(response.status).json({
              error: errorData.error?.message || 'Google API request failed after retries and fallback.',
              details: errorData
            });
          }
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.error(`❌ [Attempt ${attempt + 1}] Network/fetch error:`, err);
        if (attempt < maxRetries) {
          console.warn(`⚠️ Retrying in 500ms...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          if (currentModel.includes('gemma-4')) {
            console.warn(`🚨 Gemma-4 fetch failed. Falling back to gemini-2.5-flash.`);
            currentModel = 'gemini-2.5-flash';
            currentApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:streamGenerateContent?key=${apiKey}&alt=sse`;
            
            const cleanContents = JSON.parse(JSON.stringify(messages));
            currentPayload = {
              contents: cleanContents,
              generationConfig: {
                temperature: 0.3,
                topP: 0.95,
                maxOutputTokens: 8192,
                thinkingConfig: {
                  thinkingBudget: mode === 'fast' ? 0 : 2048
                }
              }
            };
            if (systemPrompt) {
              currentPayload.systemInstruction = {
                parts: [{ text: systemPrompt }]
              };
            }
            attempt = -1;
          } else {
            return res.status(500).json({ error: 'Internal Server Error during fetch', details: err.message });
          }
        }
      }
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

// Local proxy for the school's point conversion API
let cachedCookies = null;
let cachedCsrfToken = null;
let cacheTimestamp = 0;

async function getSessionToken() {
  if (cachedCookies && cachedCsrfToken && (Date.now() - cacheTimestamp < 30 * 60 * 1000)) {
    return { cookies: cachedCookies, csrfToken: cachedCsrfToken };
  }

  console.log('🔄 [Proxy] Session cache expired or empty. Refreshing session from CTUT server...');
  const pageResponse = await fetch('https://quanlytuyensinh.ctuet.edu.vn/pointconversion', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  const cookies = pageResponse.headers.get('set-cookie');
  const html = await pageResponse.text();
  
  const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/) || html.match(/data-csrf="([^"]+)"/);
  if (!csrfMatch) {
    throw new Error('Failed to find CSRF token on CTUT page.');
  }

  const csrfToken = csrfMatch[1];
  let cookieHeader = '';
  if (cookies) {
    cookieHeader = cookies.split(',')
      .map(c => c.split(';')[0].trim())
      .join('; ');
  }

  cachedCookies = cookieHeader;
  cachedCsrfToken = csrfToken;
  cacheTimestamp = Date.now();

  console.log('✅ [Proxy] Session refreshed. Token:', csrfToken);
  return { cookies: cookieHeader, csrfToken };
}

app.post('/pointconversion', async (req, res) => {
  try {
    let { cookies, csrfToken } = await getSessionToken();
    const payload = req.body;

    let response = await fetch('https://quanlytuyensinh.ctuet.edu.vn/pointconversion?ajax=calculate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': csrfToken,
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });

    if (response.status === 419) {
      console.warn('⚠️ [Proxy] 419 CSRF mismatch. Invalidating session cache and retrying...');
      cachedCookies = null;
      cachedCsrfToken = null;
      
      const session = await getSessionToken();
      cookies = session.cookies;
      csrfToken = session.csrfToken;

      response = await fetch('https://quanlytuyensinh.ctuet.edu.vn/pointconversion?ajax=calculate', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': csrfToken,
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: JSON.stringify(payload)
      });
    }

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('❌ [Proxy] Error during point conversion calculation:', error);
    return res.status(500).json({ error: 'Internal Server Error during conversion calculation proxy', details: error.message });
  }
});

// Start the server (watch reload v7)
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 CTUT 2026 AI Admission Advisor is running!`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
