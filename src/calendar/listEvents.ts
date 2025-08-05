import { google } from 'googleapis';
import type { CalendarEvent, GraphState } from '../graph/graphState.js';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Configuration for filtering events
const FILTER_CONFIG = {
  // Time window for upcoming meetings (in hours)
  upcomingHoursWindow: 3,
  
  // Keywords to look for in event summaries (case-insensitive)
  clientKeywords: [
    'client',
    'project',
    'demo',
    'presentation',
    'proposal',
    'discovery',
    'consultation',
    'workshop',
    'kickoff',
    'review',
    'stakeholder',
    'prospect',
    'sales',
    'business'
  ],
  
  // Internal email domains to exclude when looking for external attendees
  internalDomains: [
    '@licet.ac.in',
    '@cprime.com',
    '@cprimetechnologies.com'
  ],
  
  // Minimum number of external attendees required
  minExternalAttendees: 1,
  
  // PDF tracking file path
  pdfTrackingFile: path.join(process.cwd(), 'summaries', '.pdf-tracking.json')
};

interface PDFTrackingRecord {
  eventId: string;
  eventHash: string;
  generatedAt: string;
  pdfPath: string;
  meetingStartTime: string;
  meetingSummary: string;
}

interface PDFTrackingData {
  [eventId: string]: PDFTrackingRecord;
}

export async function listUpcomingEvents(auth: OAuth2Client): Promise<GraphState> {
  const calendar = google.calendar({ version: 'v3', auth });
  
  // Calculate time window (next 3 hours)
  const now = new Date();
  const threeHoursLater = new Date(now.getTime() + (FILTER_CONFIG.upcomingHoursWindow * 60 * 60 * 1000));
  
  console.log(`🕐 Looking for meetings between:`);
  console.log(`   From: ${now.toLocaleString()}`);
  console.log(`   To:   ${threeHoursLater.toLocaleString()}`);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: threeHoursLater.toISOString(), // Only next 3 hours
    maxResults: 50,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = res.data.items;
  if (!events || events.length === 0) {
    console.log('❌ No upcoming events found in the next 3 hours.');
    return {
      calendarEvents: [],
      externalResearch: {
        searchQuery: '',
        companyNews: '',
        contactUpdates: '',
      },
    };
  }

  // Convert to structured events with event IDs for tracking
  const allStructuredEvents: (CalendarEvent & { eventId: string })[] = events.map(event => ({
    eventId: event.id || generateEventId(event),
    startTime: event.start?.dateTime || event.start?.date || '',
    summary: event.summary || 'No title',
    description: event.description || '',
    attendees: (event.attendees?.map(a => a.email).filter((email): email is string => !!email)) || [],
    location: event.location || '',
  }));

  console.log(`📅 Found ${allStructuredEvents.length} total events in next 3 hours`);

  // Apply client/external filters
  const clientEvents = allStructuredEvents.filter(event => {
    const passesClientFilter = hasClientKeywords(event.summary);
    const passesAttendeeFilter = hasExternalAttendees(event.attendees);
    const isInTimeWindow = isEventInTimeWindow(event.startTime, now, threeHoursLater);
    
    console.log(`\n🔍 Filtering Event: "${event.summary}"`);
    console.log(`   Time: ${new Date(event.startTime).toLocaleString()}`);
    console.log(`   In time window: ${isInTimeWindow ? '✅' : '❌'}`);
    console.log(`   Client keywords: ${passesClientFilter ? '✅' : '❌'}`);
    console.log(`   External attendees: ${passesAttendeeFilter ? '✅' : '❌'}`);
    
    return isInTimeWindow && (passesClientFilter || passesAttendeeFilter);
  });

  console.log(`\n📋 Found ${clientEvents.length} client meetings in next 3 hours:`);
  clientEvents.forEach((event, index) => {
    const timeUntil = getTimeUntilMeeting(event.startTime);
    console.log(`   ${index + 1}. ${event.summary} - ${timeUntil}`);
  });

  // Remove eventId from the final result to match CalendarEvent interface
  const finalEvents: CalendarEvent[] = clientEvents.map(({ eventId, ...event }) => event);

  return {
    calendarEvents: finalEvents,
    clientEventIds: clientEvents.map(e => e.eventId), // Store IDs separately for PDF tracking
    externalResearch: {
      searchQuery: '',
      companyNews: '',
      contactUpdates: '',
    },
  };
}

/**
 * Check if PDF has already been generated for this meeting
 */
export function hasPdfBeenGenerated(event: CalendarEvent, eventId?: string): boolean {
  try {
    // Ensure summaries directory exists
    const summariesDir = path.dirname(FILTER_CONFIG.pdfTrackingFile);
    if (!fs.existsSync(summariesDir)) {
      fs.mkdirSync(summariesDir, { recursive: true });
    }

    // Check if tracking file exists
    if (!fs.existsSync(FILTER_CONFIG.pdfTrackingFile)) {
      return false;
    }

    const trackingData: PDFTrackingData = JSON.parse(
      fs.readFileSync(FILTER_CONFIG.pdfTrackingFile, 'utf8')
    );

    const currentEventId = eventId || generateEventId(event);
    const currentEventHash = generateEventHash(event);

    const existingRecord = trackingData[currentEventId];
    
    if (existingRecord) {
      // Check if event details have changed (hash comparison)
      if (existingRecord.eventHash === currentEventHash) {
        console.log(`📄 PDF already exists for: ${event.summary}`);
        console.log(`   Generated: ${existingRecord.generatedAt}`);
        console.log(`   Path: ${existingRecord.pdfPath}`);
        return true;
      } else {
        console.log(`🔄 Event details changed for: ${event.summary} - will regenerate PDF`);
        return false;
      }
    }

    return false;
  } catch (error) {
    console.error('❌ Error checking PDF tracking:', error);
    return false; // If there's an error, allow PDF generation
  }
}

/**
 * Mark PDF as generated for this meeting
 */
export function markPdfAsGenerated(event: CalendarEvent, pdfPath: string, eventId?: string): void {
  try {
    // Ensure summaries directory exists
    const summariesDir = path.dirname(FILTER_CONFIG.pdfTrackingFile);
    if (!fs.existsSync(summariesDir)) {
      fs.mkdirSync(summariesDir, { recursive: true });
    }

    let trackingData: PDFTrackingData = {};
    
    // Load existing data if file exists
    if (fs.existsSync(FILTER_CONFIG.pdfTrackingFile)) {
      trackingData = JSON.parse(fs.readFileSync(FILTER_CONFIG.pdfTrackingFile, 'utf8'));
    }

    const currentEventId = eventId || generateEventId(event);
    const record: PDFTrackingRecord = {
      eventId: currentEventId,
      eventHash: generateEventHash(event),
      generatedAt: new Date().toISOString(),
      pdfPath,
      meetingStartTime: event.startTime,
      meetingSummary: event.summary
    };

    trackingData[currentEventId] = record;

    // Clean up old records (older than 7 days)
    cleanupOldRecords(trackingData);

    // Save updated tracking data
    fs.writeFileSync(FILTER_CONFIG.pdfTrackingFile, JSON.stringify(trackingData, null, 2));
    console.log(`✅ Marked PDF as generated for: ${event.summary}`);
  } catch (error) {
    console.error('❌ Error marking PDF as generated:', error);
  }
}

/**
 * Get all client meetings that need PDF generation
 */
export async function getClientMeetingsForPdfGeneration(auth: OAuth2Client): Promise<(CalendarEvent & { eventId: string })[]> {
  const result = await listUpcomingEvents(auth);
  const clientEventIds = (result as any).clientEventIds || [];
  
  // Filter out meetings that already have PDFs generated
  const meetingsNeedingPdfs = result.calendarEvents.map((event, index) => ({
    ...event,
    eventId: clientEventIds[index] || generateEventId(event)
  })).filter(event => {
    const needsPdf = !hasPdfBeenGenerated(event, event.eventId);
    if (!needsPdf) {
      console.log(`⏭️  Skipping PDF generation for: ${event.summary} (already exists)`);
    }
    return needsPdf;
  });

  console.log(`\n📊 Summary:`);
  console.log(`   Total client meetings in next 3 hours: ${result.calendarEvents.length}`);
  console.log(`   Meetings needing new PDFs: ${meetingsNeedingPdfs.length}`);

  return meetingsNeedingPdfs;
}

// Helper functions

function generateEventId(event: any): string {
  // Generate a consistent ID based on event details
  const idString = `${event.summary}-${event.startTime}-${event.location}`;
  return crypto.createHash('md5').update(idString).digest('hex').substring(0, 12);
}

function generateEventHash(event: CalendarEvent): string {
  // Generate hash of event details to detect changes
  const eventString = JSON.stringify({
    summary: event.summary,
    startTime: event.startTime,
    description: event.description,
    attendees: event.attendees.sort(), // Sort to ensure consistent hash
    location: event.location
  });
  return crypto.createHash('sha256').update(eventString).digest('hex');
}

function isEventInTimeWindow(eventStartTime: string, windowStart: Date, windowEnd: Date): boolean {
  const eventTime = new Date(eventStartTime);
  return eventTime >= windowStart && eventTime <= windowEnd;
}

function getTimeUntilMeeting(startTime: string): string {
  const now = new Date();
  const meetingTime = new Date(startTime);
  const diffMs = meetingTime.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffHours > 0) {
    return `in ${diffHours}h ${diffMinutes}m`;
  } else {
    return `in ${diffMinutes}m`;
  }
}

function cleanupOldRecords(trackingData: PDFTrackingData): void {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  Object.keys(trackingData).forEach(eventId => {
    const record = trackingData[eventId];
    const meetingTime = new Date(record.meetingStartTime);
    
    if (meetingTime < sevenDaysAgo) {
      console.log(`🧹 Cleaning up old PDF record: ${record.meetingSummary}`);
      delete trackingData[eventId];
    }
  });
}

function hasClientKeywords(summary: string): boolean {
  const summaryLower = summary.toLowerCase();
  
  const matchedKeywords = FILTER_CONFIG.clientKeywords.filter(keyword => 
    summaryLower.includes(keyword.toLowerCase())
  );
  
  if (matchedKeywords.length > 0) {
    console.log(`     📝 Matched keywords: ${matchedKeywords.join(', ')}`);
    return true;
  }
  
  return false;
}

function hasExternalAttendees(attendees: string[]): boolean {
  if (attendees.length === 0) {
    console.log(`     👥 No attendees found`);
    return false;
  }
  
  const externalAttendees = attendees.filter(email => {
    const isExternal = !FILTER_CONFIG.internalDomains.some(domain => 
      email.toLowerCase().includes(domain.toLowerCase())
    );
    return isExternal;
  });
  
  console.log(`     👥 External attendees (${externalAttendees.length}/${attendees.length}): ${externalAttendees.join(', ')}`);
  
  return externalAttendees.length >= FILTER_CONFIG.minExternalAttendees;
}
