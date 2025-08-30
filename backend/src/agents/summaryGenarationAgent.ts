import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import type { GraphState, CalendarEvent, RetrievedMeeting } from '../graph/graphState.js';
import { embedAndStoreEvent } from '../embeddings/embedAndStore.js';

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
      
      console.log('📝 Attempting to store meeting data');
      await embedAndStoreEvent(enhancedEvent);
      console.log('✅ Summary stored in database');
    } catch (error) {
      console.error('❌ Failed to store summary:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      });
    }

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
${summary.externalIntelligence
  .replace(/Hunter\.io|Hunter|research conducted|Research failed|Limited info found|No verifiable|verified data|profile yielded|limited available|AI for \d+ attendee\(s\)/gi, '')
  .replace(/\s+-\s+limited\s+.*?available\.?/gi, '')
  .replace(/\s+/g, ' ')
  .trim()}

${hasAttendeeResearch && state.externalResearch?.contactUpdates ? `\n## 👥 KEY STAKEHOLDER INSIGHTS
${state.externalResearch.contactUpdates
  .replace(/Hunter\.io|Hunter|research conducted|Research failed|Limited info found|No verifiable|verified data|profile yielded|limited available|AI for \d+ attendee\(s\)/gi, '')
  .replace(/\s+-\s+limited\s+.*?available\.?/gi, '')
  .replace(/\s+/g, ' ')
  .trim()}` : ''}

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