import { google } from 'googleapis';
import dotenv from 'dotenv';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure we store the token outside the build dir
const TOKEN_PATH = path.resolve(__dirname, '../auth/token.json');

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export async function authorizeAndListEvents(): Promise<void> {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);
    await listUpcomingEvents();
  } else {
    await getAccessTokenPrompt();
  }
}

async function getAccessTokenPrompt(): Promise<void> {
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
      resolve(answer.trim()); // ensure no newline issues
    });
  });

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // ✅ Ensure directory exists before writing token
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));

    console.log('✅ Token stored to', TOKEN_PATH);
    await listUpcomingEvents();
  } catch (err) {
    console.error('❌ Error retrieving access token', err);
  }
}

async function listUpcomingEvents(): Promise<void> {
  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = res.data.items;
  if (!events || events.length === 0) {
    console.log('No upcoming events found.');
    return;
  }

  const structuredEvents = events.map(event => ({
    startTime: event.start?.dateTime || event.start?.date || '',
    summary: event.summary || 'No title',
    description: event.description || '',
    attendees: event.attendees?.map(a => a.email) || [],
    location: event.location || '',
  }));

  console.log('📅 Structured Events:\n', JSON.stringify(structuredEvents, null, 2));
}
