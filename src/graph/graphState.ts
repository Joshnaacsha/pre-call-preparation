// Updated interfaces
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
  searchQuery: string;
  companyNews?: string;
  contactUpdates?: string;
}

export interface GraphState {
  calendarEvents: CalendarEvent[];
  clientEventIds?: string[]; // Added for PDF tracking
  previousMeetingsByProject?: Record<string, RetrievedMeeting[]>;
  projectNotesFromDB?: Record<string, string[]>;
  externalResearch?: ExternalResearchResult;
  summary?: string;
}