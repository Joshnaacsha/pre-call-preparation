import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import type { GraphState, CalendarEvent, RetrievedMeeting } from '../graph/graphState.js';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Simplified company metadata - only essentials
const COMPANY_METADATA = {
  name: "Cprime Technologies India Pvt Ltd",
  tagline: "Leading consulting partner in digital transformation & cloud migration",
  coreServices: [
    "Cloud Migration & Architecture",
    "DevOps & CI/CD Implementation", 
    "Digital Transformation Consulting"
  ],
  keyDifferentiators: [
    "End-to-end cloud migration expertise",
    "AWS Advanced Consulting Partner",
    "Located in IITM Research Park, Chennai"
  ]
};

interface MeetingSummary {
  meetingType: 'discovery' | 'follow-up' | 'proposal' | 'execution-review' | 'other';
  clientContext: string;
  pastEngagement: string;
  externalIntelligence: string;
  talkingPoints: string[];
  keyQuestions: string[];
  risks: string[];
  opportunities: string[];
}

export async function generateMeetingSummary(state: GraphState): Promise<GraphState> {
  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.warn('⚠️ No calendar events found for summary generation.');
    return {
      ...state,
      summary: 'No meeting data available for summary generation.',
    };
  }

  const currentEvent = state.calendarEvents[0];
  const projectName = currentEvent.summary.replace(/\(.*?\)/g, '').trim();
  const previousMeetings = state.previousMeetingsByProject?.[currentEvent.summary] || [];
  const externalResearch = state.externalResearch;
  const projectNotes = state.projectNotesFromDB?.[projectName] || [];

  console.log('📋 Generating concise meeting summary...');

  const meetingType = determineMeetingType(currentEvent, previousMeetings);
  console.log(`📊 Meeting type identified: ${meetingType}`);

  const prompt = `
Create a CONCISE pre-call briefing (MAX 2 pages when printed) for a sales/consulting team.

COMPANY: ${COMPANY_METADATA.name} - ${COMPANY_METADATA.tagline}
SERVICES: ${COMPANY_METADATA.coreServices.join(' | ')}

MEETING: ${currentEvent.summary}
DATE: ${currentEvent.startTime}
TYPE: ${meetingType}
LOCATION: ${currentEvent.location || 'Not specified'}
ATTENDEES: ${currentEvent.attendees.join(', ')}

PREVIOUS MEETINGS: ${previousMeetings.length} meeting(s)
${previousMeetings.slice(0, 2).map(m => `• ${m.metadata.summary}: ${m.pageContent.slice(0, 200)}...`).join('\n')}

PROJECT NOTES FROM DATABASE:
${projectNotes.length > 0 ? projectNotes.map(note => `• ${note}`).join('\n') : 'No project notes found in database.'}

EXTERNAL RESEARCH:
Search Query: ${externalResearch?.searchQuery || 'No search conducted'}
Company News: ${externalResearch?.companyNews || 'No external news found.'}

PROFESSIONAL ATTENDEE INTELLIGENCE:
${externalResearch?.contactUpdates || 'No attendee profile research conducted.'}

CURRENT MEETING DESCRIPTION:
${currentEvent.description || 'No meeting description provided.'}

Return ONLY a JSON object with CONCISE content:
{
  "meetingType": "${meetingType}",
  "clientContext": "2-3 sentences: who they are, what they do, project context based on all available data",
  "pastEngagement": "1-2 sentences: key previous interactions summary including project notes if available",
  "externalIntelligence": "1-2 sentences: relevant external news/insights and key attendee insights from professional research",
  "talkingPoints": [
    "3-4 specific, actionable talking points that connect our services to their needs based on attendee profiles and context"
  ],
  "keyQuestions": [
    "3-4 strategic questions to ask based on meeting history, attendee profiles, and context"  
  ],
  "risks": [
    "2-3 key risks or concerns based on project history, attendee profiles, and external intelligence"
  ],
  "opportunities": [
    "2-3 business opportunities based on all available context including attendee decision-making authority"
  ]
}

Keep ALL content brief and actionable. Focus on intelligence that drives conversation, not generic information.
Use all available context: previous meetings, project notes, external research, attendee profiles, and current meeting details.
Pay special attention to attendee insights for personalized approaches.
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const raw = await result.response.text();
    const parsed: MeetingSummary = JSON.parse(
      raw.trim().replace(/^```json/, '').replace(/```$/, '')
    );

    const formattedSummary = formatConciseSummary(parsed, currentEvent, projectName, state);

    console.log('✅ Concise meeting summary generated successfully');
    console.log('📄 Summary preview:');
    console.log(formattedSummary.slice(0, 300) + '...');

    return {
      ...state,
      summary: formattedSummary,
    };
  } catch (error) {
    console.error('❌ Error generating meeting summary:', error);
    
    const fallbackSummary = generateFallbackSummary(currentEvent, previousMeetings, externalResearch, state);
    
    return {
      ...state,
      summary: fallbackSummary,
    };
  }
}

function determineMeetingType(event: CalendarEvent, previousMeetings: RetrievedMeeting[]): string {
  const title = event.summary.toLowerCase();
  const description = (event.description || '').toLowerCase();
  
  if (title.includes('discovery') || title.includes('initial') || previousMeetings.length === 0) {
    return 'discovery';
  } else if (title.includes('proposal') || description.includes('proposal')) {
    return 'proposal';
  } else if (title.includes('execution') || title.includes('cutover') || title.includes('monitoring')) {
    return 'execution-review';
  } else if (previousMeetings.length > 0) {
    return 'follow-up';
  } else {
    return 'other';
  }
}

function formatConciseSummary(
  summary: MeetingSummary, 
  currentEvent: CalendarEvent, 
  projectName: string,
  state: GraphState
): string {
  const date = new Date(currentEvent.startTime).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const previousMeetings = state.previousMeetingsByProject?.[currentEvent.summary] || [];
  const projectNotes = state.projectNotesFromDB?.[projectName] || [];
  const hasAttendeeResearch = state.externalResearch?.contactUpdates && 
    state.externalResearch.contactUpdates !== 'No attendee profile research conducted.' &&
    !state.externalResearch.contactUpdates.includes('skipped');

  return `# PRE-CALL BRIEFING: ${currentEvent.summary}

**Meeting:** ${date}  
**Type:** ${summary.meetingType.toUpperCase()}  
**Location:** ${currentEvent.location || 'Not specified'}  
**Attendees:** ${currentEvent.attendees.join(', ')}

---

## CLIENT CONTEXT
${summary.clientContext}

## ENGAGEMENT HISTORY
${summary.pastEngagement}

${previousMeetings.length > 0 ? `**Previous Meetings:** ${previousMeetings.length} meetings on record` : '**Previous Meetings:** First meeting with this client'}

${projectNotes.length > 0 ? `**Project Notes:** ${projectNotes.length} notes from database` : ''}

## EXTERNAL INTELLIGENCE
${summary.externalIntelligence}

${state.externalResearch?.searchQuery ? `**Research Query:** "${state.externalResearch.searchQuery}"` : ''}

${hasAttendeeResearch ? '\n## ATTENDEE INTELLIGENCE' : ''}
${hasAttendeeResearch ? state.externalResearch!.contactUpdates : ''}

---

## TALKING POINTS
${summary.talkingPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}

## KEY QUESTIONS
${summary.keyQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

---

## RISKS & OPPORTUNITIES

**⚠️ Risks:** ${summary.risks.join(' • ')}

**🚀 Opportunities:** ${summary.opportunities.join(' • ')}

---

## CPRIME EDGE
**Services:** ${COMPANY_METADATA.coreServices.join(' | ')}  
**Differentiators:** ${COMPANY_METADATA.keyDifferentiators.join(' • ')}

## MEETING CONTEXT
${currentEvent.description ? `**Meeting Description:** ${currentEvent.description}` : '**Meeting Description:** Not provided'}

**Pre-Meeting Checklist:** Review action items • Prepare technical diagrams • Confirm attendees • Ready follow-up template

---

**Data Sources:** ${previousMeetings.length} prev meetings • ${projectNotes.length} project notes • External research: ${state.externalResearch?.companyNews ? 'Yes' : 'No'} • Attendee profiles: ${hasAttendeeResearch ? 'Yes' : 'No'}

*Generated ${new Date().toISOString().split('T')[0]} | Confidential*`;
}

function generateFallbackSummary(
  event: CalendarEvent, 
  previousMeetings: RetrievedMeeting[], 
  externalResearch?: { searchQuery?: string; companyNews?: string; contactUpdates?: string },
  state?: GraphState
): string {
  const projectName = event.summary.replace(/\(.*?\)/g, '').trim();
  const projectNotes = state?.projectNotesFromDB?.[projectName] || [];
  const hasAttendeeResearch = externalResearch?.contactUpdates && 
    externalResearch.contactUpdates !== 'No attendee profile research conducted.' &&
    !externalResearch.contactUpdates.includes('skipped');

  return `# PRE-CALL BRIEFING: ${event.summary}

**Meeting:** ${new Date(event.startTime).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}  
**Type:** ${previousMeetings.length > 0 ? 'FOLLOW-UP' : 'DISCOVERY'}  
**Location:** ${event.location || 'Not specified'}  
**Attendees:** ${event.attendees.join(', ')}

---

## CONTEXT
${previousMeetings.length > 0 ? `Follow-up meeting (${previousMeetings.length} prior meetings)` : 'Initial client meeting'} regarding ${event.summary}.

${projectNotes.length > 0 ? `**Project Notes Available:** ${projectNotes.length} notes from database` : ''}

## INTELLIGENCE
${externalResearch?.companyNews || 'Limited external information available.'}
${externalResearch?.searchQuery ? `**Search Conducted:** "${externalResearch.searchQuery}"` : ''}

${hasAttendeeResearch ? '\n## ATTENDEE INTELLIGENCE' : ''}
${hasAttendeeResearch ? externalResearch!.contactUpdates : ''}

## APPROACH
• Understand client needs and current challenges
• Present relevant Cprime solutions and case studies  
• Establish clear next steps and follow-up actions
${hasAttendeeResearch ? '• Leverage attendee profile insights for personalized approach' : ''}

**Services:** ${COMPANY_METADATA.coreServices.join(' | ')}

${event.description ? `## MEETING DESCRIPTION
${event.description}` : ''}

---
*Fallback summary - Limited data available | Generated ${new Date().toISOString().split('T')[0]}*`;
}