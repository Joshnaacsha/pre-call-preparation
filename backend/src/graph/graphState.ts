// Updated interfaces with proper case study support
export interface CalendarEvent {
  startTime: string;
  summary: string;
  description: string;
  attendees: string[];
  location: string;
  organizer?: string;
}

export interface RetrievedMeeting {
  metadata: {
    summary: string;
    startTime: string;
  };
  pageContent: string;
}

// Case study interface
export interface CaseStudy {
  title: string;
  industry: string;
  technologies?: string[];
  description: string;
  url: string;
  source?: string;
  relevanceScore: number;
  relevance_reasoning: string;
  tags?: string[];
  'Industry/Sector'?: string;
  industry_sector?: string;
  key_technologies_used?: string[];
}

// Key stakeholder interface
export interface KeyStakeholder {
  name: string;
  title: string;
  focus_area: string;
}

// Sales intelligence report interface
export interface SalesIntelligenceReport {
  companyName: string;
  executiveSummary: string;
  financialPerformance: string;
  leadershipOrganization: string;
  strategicInitiatives: string;
  challengesPainPoints: string;
  marketPosition: string;
  salesOpportunities: string;
  riskFactors: string;
  keyStakeholders: KeyStakeholder[];
  recommendedApproach: string;
  confidenceScore: number;
  citations: string[];
  cprimeCaseStudies?: CaseStudy[];
  inryCaseStudies?: CaseStudy[];
}

export interface ExternalResearchResult {
  searchQuery: string;
  companyNews?: string;
  contactUpdates?: string;
  salesIntelligence?: Partial<SalesIntelligenceReport>;
  cprimeCaseStudies?: CaseStudy[];
  inryCaseStudies?: CaseStudy[];
}

export interface GraphState {
  calendarEvents: CalendarEvent[];
  clientEventIds?: string[];
  previousMeetingsByProject?: Record<string, RetrievedMeeting[]>;
  projectNotesFromDB?: Record<string, string[]>;
  externalResearch?: ExternalResearchResult;
  summary?: string;
  pdfPath?: string;
}