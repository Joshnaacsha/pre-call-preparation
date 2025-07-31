import { google } from 'googleapis';
import type { CalendarEvent, GraphState } from '../graph/graphState.js';
import { OAuth2Client } from 'google-auth-library';

export async function listUpcomingEvents(auth: OAuth2Client): Promise<GraphState> {
  const calendar = google.calendar({ version: 'v3', auth });

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
    return { calendarEvents: [] };
  }

  const structuredEvents: CalendarEvent[] = events.map(event => ({
    startTime: event.start?.dateTime || event.start?.date || '',
    summary: event.summary || 'No title',
    description: event.description || '',
    attendees: (event.attendees?.map(a => a.email).filter((email): email is string => !!email)) || [],
    location: event.location || '',
  }));

  console.log('📅 Structured Events:\n', JSON.stringify(structuredEvents, null, 2));

  return {
    calendarEvents: structuredEvents,
  };
}
