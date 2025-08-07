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
Create a CONCISE pre-call briefing (MAX 2 pages when printed) for a SALES AGENT focused on closing deals and advancing opportunities.

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

Return ONLY a JSON object with SALES-FOCUSED content:
{
  "meetingType": "${meetingType}",
  "clientContext": "2-3 sentences: WHO they are, their BUDGET/AUTHORITY level, PAIN POINTS we can solve, and their BUYING TIMELINE based on all available data",
  "pastEngagement": "1-2 sentences: What COMMITMENTS were made, OBJECTIONS raised, BUDGET discussed, and current DEAL STAGE",
  "externalIntelligence": "1-2 sentences: Market pressures/news that create URGENCY, and key decision-maker INFLUENCE/AUTHORITY from attendee research",
  "talkingPoints": [
    "3-4 specific VALUE PROPOSITIONS that address their pain points, create urgency, and differentiate us from competitors - focus on ROI and business impact"
  ],
  "keyQuestions": [
    "3-4 strategic QUALIFYING questions to uncover budget, timeline, decision process, and pain severity - designed to advance the sale"  
  ],
  "risks": [
    "2-3 DEAL RISKS: competition threats, budget concerns, decision delays, stakeholder objections that could kill this opportunity"
  ],
  "opportunities": [
    "2-3 SALES OPPORTUNITIES: upsell potential, urgency drivers, competitive advantages, ways to expand deal size or accelerate timeline"
  ]
}

Think like a QUOTA-CARRYING SALES REP. Every piece of intelligence should help:
- Qualify the opportunity (BANT: Budget, Authority, Need, Timeline)
- Handle objections before they arise
- Create urgency and competitive differentiation
- Advance to next stage or close the deal
- Identify expansion opportunities

Focus on REVENUE IMPACT, not technical details. Use sales language: prospects, pipeline, close rate, deal size, etc.
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

  return `# 💼 SALES BRIEFING: ${currentEvent.summary}

**Meeting:** ${date}  
**Deal Stage:** ${summary.meetingType.toUpperCase()}  
**Location:** ${currentEvent.location || 'Not specified'}  
**Key Stakeholders:** ${currentEvent.attendees.join(', ')}

---

## 🎯 PROSPECT PROFILE & QUALIFICATION
${summary.clientContext}

## 📈 DEAL HISTORY & PIPELINE STATUS
${summary.pastEngagement}

${previousMeetings.length > 0 ? `**Sales Cycle:** ${previousMeetings.length} touchpoints completed` : '**Sales Cycle:** Initial prospecting call'}

${projectNotes.length > 0 ? `**CRM Notes:** ${projectNotes.length} entries logged` : ''}

## 🔍 COMPETITIVE INTELLIGENCE & MARKET PRESSURE
${summary.externalIntelligence}

${state.externalResearch?.searchQuery ? `**Market Research:** "${state.externalResearch.searchQuery}"` : ''}

${hasAttendeeResearch ? '\n## 👥 DECISION MAKER INTELLIGENCE' : ''}
${hasAttendeeResearch ? state.externalResearch!.contactUpdates : ''}

---

## 💡 VALUE PROPOSITIONS (Lead with ROI)
${summary.talkingPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}

## ❓ QUALIFYING QUESTIONS (Advance the Sale)
${summary.keyQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

---

## ⚠️ DEAL RISKS & OBJECTION HANDLING

**Potential Deal Killers:** ${summary.risks.join(' • ')}

## 🚀 SALES OPPORTUNITIES & EXPANSION

**Revenue Growth Potential:** ${summary.opportunities.join(' • ')}

---

## 🏆 CPRIME COMPETITIVE ADVANTAGES
**Core Solutions:** ${COMPANY_METADATA.coreServices.join(' | ')}  
**Win Themes:** ${COMPANY_METADATA.keyDifferentiators.join(' • ')}

**Sales Playbook:** Qualify budget/timeline • Present ROI case studies • Handle objections • Secure next step commitment

---

**Pipeline Intelligence:** ${previousMeetings.length} prev touchpoints • ${projectNotes.length} CRM entries • Market research: ${state.externalResearch?.companyNews ? 'Complete' : 'Limited'} • Stakeholder mapping: ${hasAttendeeResearch ? 'Complete' : 'Needed'}

*Sales Intel Generated ${new Date().toISOString().split('T')[0]} | Confidential - Do Not Forward*`;
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

  return `# 💼 SALES BRIEFING: ${event.summary}

**Meeting:** ${new Date(event.startTime).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}  
**Deal Stage:** ${previousMeetings.length > 0 ? 'FOLLOW-UP' : 'PROSPECTING'}  
**Location:** ${event.location || 'Not specified'}  
**Key Stakeholders:** ${event.attendees.join(', ')}

---

## 🎯 PROSPECT QUALIFICATION STATUS
${previousMeetings.length > 0 ? `Active opportunity (${previousMeetings.length} sales touchpoints)` : 'New prospect - qualification needed'} for ${event.summary}.

${projectNotes.length > 0 ? `**CRM Intel:** ${projectNotes.length} sales notes available` : ''}

## 🔍 COMPETITIVE LANDSCAPE & URGENCY DRIVERS
${externalResearch?.companyNews || 'Limited market intelligence available - research their recent challenges and growth initiatives.'}
${externalResearch?.searchQuery ? `**Sales Research:** "${externalResearch.searchQuery}"` : ''}

${hasAttendeeResearch ? '\n## 👥 DECISION MAKER PROFILE' : ''}
${hasAttendeeResearch ? externalResearch!.contactUpdates : ''}

## 💡 SALES APPROACH
• **Qualify:** Budget authority, timeline, and decision process
• **Value Prop:** Position our ${COMPANY_METADATA.coreServices.join(' and ')} expertise  
• **Next Steps:** Secure technical discovery or proposal presentation
${hasAttendeeResearch ? '• **Personalize:** Use stakeholder insights for tailored messaging' : ''}

**Win Themes:** ${COMPANY_METADATA.keyDifferentiators.join(' • ')}

---
*Sales Intelligence Brief - Limited data available | Generated ${new Date().toISOString().split('T')[0]}*`;
}