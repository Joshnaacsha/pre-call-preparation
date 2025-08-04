import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';
import { fileURLToPath } from 'url';
import process from 'process';
import type { GraphState } from '../graph/graphState.js';
import { listUpcomingEvents } from './listEvents.js';

dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_PATH = path.resolve(process.cwd(), 'src/auth/token.json');

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export async function authorizeAndListEvents(): Promise<GraphState> {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);
    return await listUpcomingEvents(oAuth2Client);
  } else {
    return await getAccessTokenPrompt();
  }
}

async function getAccessTokenPrompt(): Promise<GraphState> {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Authorize this app by visiting this url:', authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const code = await new Promise<string>((resolve) => {
    rl.question('Enter the code from that page here: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('✅ Token stored to', TOKEN_PATH);

    return await listUpcomingEvents(oAuth2Client);
  } catch (err) {
    console.error('❌ Error retrieving access token', err);
  return {
  calendarEvents: [],
  externalResearch: {
    searchQuery: '', // or set this later using another agent
    companyNews: '',
    contactUpdates: '',
  },
};


  }
}
