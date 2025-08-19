import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import process from 'process';
import type { GraphState } from '../graph/graphState.js';
import { listUpcomingEvents } from './listEvents.js';

dotenv.config();

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

export async function authorizeAndListEvents(): Promise<GraphState> {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);
    return await listUpcomingEvents(oAuth2Client);
  } else {
    console.log('⚠️  No token found. Please visit /api/auth-url to authorize the application.');
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

// Export the OAuth client so it can be used by the main server
export { oAuth2Client };