import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import process from 'process';
import type { GraphState } from '../graph/graphState.js';
import { listUpcomingEvents } from './listEvents.js';

dotenv.config();

const app = express();

app.use(cors({
  origin: ['http://localhost:3002', 'http://192.168.56.1:3002'],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json());

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_PATH = path.resolve(process.cwd(), 'src/auth/token.json');

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3001/api/oauth2callback'
);

// API endpoint to get the auth URL
app.get('/api/auth-url', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    include_granted_scopes: true
  });
  res.json({ url: authUrl });
});

// API endpoint to handle the OAuth callback
app.get('/api/oauth2callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'No code provided' });
    return;
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('✅ Token stored to', TOKEN_PATH);

    // Start the pre-call preparation process
    const events = await listUpcomingEvents(oAuth2Client);
    
    // Import the main pipeline function
    const { runScheduledPipeline } = await import('../index.js');
    
    // Start the pipeline in the background
    runScheduledPipeline().catch(error => {
      console.error('Failed to start pipeline:', error);
    });
    
    res.json({ 
      success: true, 
      message: 'Authorization successful! Pre-call preparation process has started. You will receive summaries via email shortly.' 
    });
  } catch (err) {
    console.error('❌ Error retrieving access token', err);
    res.status(500).json({ 
      error: 'Failed to retrieve access token',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export async function authorizeAndListEvents(): Promise<GraphState> {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);
    return await listUpcomingEvents(oAuth2Client);
  } else {
    return {
      calendarEvents: [],
      externalResearch: {
        searchQuery: '',
        companyNews: '',
        contactUpdates: '',
      },
    };
  }
}