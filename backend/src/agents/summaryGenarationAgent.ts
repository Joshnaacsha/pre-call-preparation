import OpenAI from 'openai';
import dotenv from 'dotenv';
import type { GraphState, CalendarEvent, RetrievedMeeting } from '../graph/graphState.js';
import { embedAndStoreEvent } from '../embeddings/embedAndStore.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    console.warn('[Warning] No calendar events found for summary generation.');
    return {
      ...state,
      summary: 'No meeting data available for summary generation.',
    };
  }

  const currentEvent = state.calendarEvents[0];
  // Extract client name from the event summary (format: "ClientName - ProjectName")
  const clientName = currentEvent.summary.split('-')[0].trim();
  const projectName = currentEvent.summary.replace(/\(.*?\)/g, '').trim();
  
  // Ensure we're working with the correct client data
  console.log('[Info] Generating summary for client:', clientName);
  
  // Reset any cross-contaminated data
  if (state.previousMeetingsByProject) {
    const cleanMeetings = Object.entries(state.previousMeetingsByProject)
      .filter(([key]) => key.toLowerCase().startsWith(clientName.toLowerCase()))
      .reduce((acc, [key, meetings]) => ({ ...acc, [key]: meetings }), {});
    state.previousMeetingsByProject = cleanMeetings;
  }
  
  const previousMeetings = state.previousMeetingsByProject?.[currentEvent.summary] || [];
  const externalResearch = {
    ...state.externalResearch,
    searchQuery: `${clientName} ${currentEvent.summary.split('-')[1]?.trim() || ''}`
  };
  const projectNotes = state.projectNotesFromDB?.[projectName] || [];

  console.log('[Info] Filtering data for client:', clientName);
  console.log('[Info] Found matching previous meetings:', previousMeetings.length);

  console.log('[Info] Generating concise meeting summary...');
  console.log('[Debug] Previous meetings:', JSON.stringify(previousMeetings, null, 2));

  // Ensure safe array operations
  const safePreviousMeetings = Array.isArray(previousMeetings) ? previousMeetings : [];
  const safeProjectNotes = Array.isArray(projectNotes) ? projectNotes : [];

  const meetingType = determineMeetingType(currentEvent, safePreviousMeetings);
  console.log(`[Info] Meeting type identified: ${meetingType}`);

  const prompt = `
Create a CONCISE pre-call briefing (MAX 2 pages when printed) for a SALES AGENT focused on closing deals and advancing opportunities.

COMPANY: ${COMPANY_METADATA.name} - ${COMPANY_METADATA.tagline}
SERVICES: ${COMPANY_METADATA.coreServices.join(' | ')}

MEETING: ${currentEvent.summary}
DATE: ${currentEvent.startTime}
TYPE: ${meetingType}
LOCATION: ${currentEvent.location || 'Not specified'}
ATTENDEES: ${currentEvent.attendees.join(', ')}

PREVIOUS MEETINGS: ${safePreviousMeetings.length} meeting(s)
${safePreviousMeetings.length > 0 
  ? safePreviousMeetings.slice(0, 2).map(m => 
      `• ${m.metadata?.summary || 'Untitled'}: ${(m.pageContent || '').slice(0, 200)}...`
    ).join('\n')
  : 'No previous meetings found.'}

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
  "clientContext": "2-3 sentences with specifics: WHO they are, precise BUDGET range if known, clear PAIN POINTS with measurable impact (e.g. current downtime %, cost overruns), and concrete BUYING TIMELINE with dates. Avoid placeholder values like X% or Y%",
  "pastEngagement": "1-2 sentences: What COMMITMENTS were made, OBJECTIONS raised, BUDGET discussed, and current DEAL STAGE",
  "externalIntelligence": "1-2 sentences: Market pressures/news that create URGENCY, and key decision-maker INFLUENCE/AUTHORITY from attendee research",
  "talkingPoints": [
    "3-4 specific VALUE PROPOSITIONS with concrete metrics from past successes (e.g. '30% cost reduction in 6 months', '99.9% uptime achievement'). Use real numbers from similar projects - no placeholder values like X% or Y%"
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
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content || '';
    const parsed: MeetingSummary = JSON.parse(
      raw.trim().replace(/^```json/, '').replace(/```$/, '')
    );

    const formattedSummary = formatConciseSummary(parsed, currentEvent, projectName, state);

    console.log('[Success] Concise meeting summary generated successfully');
    console.log('[Info] Summary preview:');
    console.log(formattedSummary.slice(0, 300) + '...');

    // Store the summary in Supabase
    try {
      // Create an enhanced event object with summary data
      const enhancedEvent = {
        ...currentEvent,
        description: formattedSummary,
        metadata: {
          client_name: currentEvent.summary.split('-')[0].trim(),
          project_name: currentEvent.summary.split('-')[1]?.trim() || currentEvent.summary,
          meeting_goal: parsed.clientContext,
          raw_summary: parsed
        }
      };
      
      console.log('[Info] Attempting to store meeting data');
      await embedAndStoreEvent(enhancedEvent);
      console.log('[Success] Summary stored in database');
    } catch (error) {
      console.error('[Error] Failed to store summary:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    return {
      ...state,
      summary: formattedSummary,
    };
  } catch (error) {
    console.error('[Error] Error generating meeting summary:', error);
    
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

  // Extract client name from event summary
  const clientName = currentEvent.summary.split('-')[0].trim();

  const previousMeetings = state.previousMeetingsByProject?.[currentEvent.summary] || [];
  const projectNotes = state.projectNotesFromDB?.[projectName] || [];
  // Only show stakeholder insights if we have meaningful data (not errors or limited info)
  const hasAttendeeResearch = state.externalResearch?.contactUpdates && 
    state.externalResearch.contactUpdates !== 'No attendee profile research conducted.' &&
    !state.externalResearch.contactUpdates.includes('skipped') &&
    !state.externalResearch.contactUpdates.includes('Limited info found') &&
    !state.externalResearch.contactUpdates.includes('No verifiable') &&
    !state.externalResearch.contactUpdates.includes('Research failed') &&
    !state.externalResearch.contactUpdates.includes('limited available') &&
    !state.externalResearch.contactUpdates.includes('AI for') &&
    !state.externalResearch.contactUpdates.includes('No key contact') &&
    !state.externalResearch.contactUpdates.includes('No attendee') &&
    state.externalResearch.contactUpdates.length > 100 &&  // Increased minimum length for more meaningful insights
    /\b(role|position|background|experience|responsibility|title)\b/i.test(state.externalResearch.contactUpdates);

  // Only list provided attendees as key stakeholders
  const providedAttendees = currentEvent.attendees && currentEvent.attendees.length > 0
    ? currentEvent.attendees.join(', ')
    : 'Not specified';

  // Expand COMPETITIVE INTELLIGENCE section with more detail if available
  let competitiveSection = summary.externalIntelligence
    // Remove metadata and research references
    .replace(/Hunter\.io|Hunter|research conducted|Research failed|Limited info found|No verifiable|verified data|profile yielded|limited available|AI for \d+ attendee\(s\)/gi, '')
    .replace(/\s+-\s+limited\s+.*?available\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Add more from companyNews and contactUpdates if available, with clean formatting
  if (state.externalResearch) {
    if (state.externalResearch.companyNews && state.externalResearch.companyNews.length > 30) {
      // Clean up company news and ensure correct client name is used
      const cleanNews = state.externalResearch.companyNews
        .replace(/\(Result \d+\)/gi, '')
        .replace(/Research completed:.*?Analysis/gs, '')
        .replace(/\b(?:Source|Result)\s*\d+:?\s*/gi, '')
        .replace(/Kissflow/g, clientName)  // Replace any incorrect client references
        .replace(/\s{2,}/g, ' ')
        .trim();
      
      // Only include if it actually mentions the correct client
      if (cleanNews && cleanNews.toLowerCase().includes(clientName.toLowerCase())) {
        competitiveSection += `\n\n**Company News:**\n${cleanNews}`;
      }
    }
    
    if (state.externalResearch.contactUpdates && state.externalResearch.contactUpdates.length > 30) {
      // Clean up contact updates by removing research metadata
      const cleanUpdates = state.externalResearch.contactUpdates
        .replace(/MEETING INTELLIGENCE.*?Analysis/gs, '')
        .replace(/STRATEGIC MEETING APPROACH.*?Analysis/gs, '')
        .replace(/Research completed:.*?Analysis/gs, '')
        .replace(/\b(?:Source|Result)\s*\d+:?\s*/gi, '')
        .replace(/•\s*Verified Intelligence:.*$/gm, '')
        .replace(/•\s*Search Sources:.*$/gm, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (cleanUpdates) {
        competitiveSection += `\n\n**Stakeholder Profile:**\n${cleanUpdates}`;
      }
    }
  }

  return `# SALES BRIEFING: ${currentEvent.summary}

**Meeting:** ${date}  
**Deal Stage:** ${summary.meetingType.toUpperCase()}  
**Location:** ${currentEvent.location || 'Not specified'}  
**Key Stakeholders:** ${providedAttendees}

---

## PROSPECT PROFILE & QUALIFICATION
${summary.clientContext}

## DEAL HISTORY & PIPELINE STATUS
${summary.pastEngagement}

${previousMeetings.length > 0 ? `**Sales Cycle:** ${previousMeetings.length} touchpoints completed` : '**Sales Cycle:** Initial prospecting call'}

${projectNotes.length > 0 ? `**CRM Notes:** ${projectNotes.length} entries logged` : ''}

## COMPETITIVE INTELLIGENCE & MARKET PRESSURE
${competitiveSection}

---

## VALUE PROPOSITIONS (Lead with ROI)
${summary.talkingPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}

## QUALIFYING QUESTIONS (Advance the Sale)
${summary.keyQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

---

## DEAL RISKS & OBJECTION HANDLING

**Potential Deal Killers:** ${summary.risks.join(' • ')}

## SALES OPPORTUNITIES & EXPANSION

**Revenue Growth Potential:** ${summary.opportunities.join(' • ')}

---

## CPRIME COMPETITIVE ADVANTAGES
**Core Solutions:** ${COMPANY_METADATA.coreServices.join(' | ')}  
**Win Themes:** ${COMPANY_METADATA.keyDifferentiators.join(' • ')}

**Sales Playbook:** Qualify budget/timeline • Present ROI case studies • Handle objections • Secure next step commitment

---

**Pipeline Intelligence:** ${previousMeetings.length} previous meetings • ${projectNotes.length} CRM entries • Stakeholder research: ${hasAttendeeResearch ? 'Complete' : 'Limited'}

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

  return `# SALES BRIEFING: ${event.summary}

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

## PROSPECT QUALIFICATION STATUS
${previousMeetings.length > 0 ? `Active opportunity (${previousMeetings.length} sales touchpoints)` : 'New prospect - qualification needed'} for ${event.summary}.

${projectNotes.length > 0 ? `**CRM Intel:** ${projectNotes.length} sales notes available` : ''}

## COMPETITIVE LANDSCAPE & URGENCY DRIVERS
${externalResearch?.companyNews || 'Limited market intelligence available - research their recent challenges and growth initiatives.'}


${hasAttendeeResearch ? '\n## DECISION MAKER PROFILE' : ''}
${hasAttendeeResearch ? externalResearch!.contactUpdates : ''}

## SALES APPROACH
• **Qualify:** Budget authority, timeline, and decision process
• **Value Prop:** Position our ${COMPANY_METADATA.coreServices.join(' and ')} expertise  
• **Next Steps:** Secure technical discovery or proposal presentation
${hasAttendeeResearch ? '• **Personalize:** Use stakeholder insights for tailored messaging' : ''}
                                                                      
**Win Themes:** ${COMPANY_METADATA.keyDifferentiators.join(' • ')}

---
*Sales Intelligence Brief - Limited data available | Generated ${new Date().toISOString().split('T')[0]}*`;
}