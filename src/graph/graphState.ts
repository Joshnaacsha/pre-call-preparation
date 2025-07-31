export interface CalendarEvent {
  startTime: string;
  summary: string;
  description: string;
  attendees: string[];
  location: string;
}

export interface RetrievedMeeting {
  metadata: {
    summary: string;
    startTime: string;
  };
  pageContent: string;
}

export interface ExternalResearchResult {
  companyNews: string;
  contactUpdates: string;
}

export interface GraphState {
  calendarEvents: CalendarEvent[]; // Structured events from Google Calendar

  previousMeetingsByProject?: Record<string, RetrievedMeeting[]>; // Similar past meetings (RAG search)

  projectNotesFromDB?: Record<string, string[]>; // Past meeting notes (added after meeting ends)

  externalResearch?: ExternalResearchResult; // Tavily result (news/social)

  summary?: string; // Final summary
}
