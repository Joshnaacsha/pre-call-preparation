import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import type { GraphState, CalendarEvent, RetrievedMeeting } from '../graph/graphState.js';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Company metadata - this can be moved to a config file or database later
const COMPANY_METADATA = {
  name: "Cprime Technologies India Pvt Ltd",
  description: "Leading consulting partner specializing in digital transformation, cloud migration, DevOps implementation, and enterprise software solutions",
  coreServices: [
    "Cloud Migration & Architecture",
    "DevOps & CI/CD Implementation", 
    "Digital Transformation Consulting",
    "Enterprise Integration Services",
    "Platform Reliability & Security",
    "Agile & Scrum Transformation"
  ],
  keyStrengths: [
    "End-to-end cloud migration expertise",
    "Strong partnership with major cloud providers (AWS, Azure, GCP)",
    "Proven track record with enterprise clients",
    "24/7 support and monitoring capabilities",
    "Located in IITM Research Park, Chennai - technology hub"
  ],
  recentAchievements: [
    "Successfully completed 50+ cloud migration projects",
    "Certified AWS Advanced Consulting Partner",
    "ISO 27001 certified for security practices",
    "Winner of 'Best DevOps Implementation' award 2024"
  ]
};

interface MeetingSummary {
  meetingType: 'discovery' | 'follow-up' | 'proposal' | 'execution-review' | 'other';
  clientOverview: string;
  pastEngagementSummary: string;
  currentProjectStatus: string;
  externalIntelligence: string;
  recommendedTalkingPoints: string[];
  keyQuestions: string[];
  riskFactors: string[];
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

  console.log('📋 Generating comprehensive meeting summary...');

  // Determine meeting type based on title and previous meetings
  const meetingType = determineMeetingType(currentEvent, previousMeetings);
  console.log(`📊 Meeting type identified: ${meetingType}`);

  const prompt = `
You are an AI assistant creating a comprehensive pre-call briefing document for a sales/consulting team.

Generate a structured summary that will help the team prepare for an upcoming client meeting.

COMPANY CONTEXT:
Company: ${COMPANY_METADATA.name}
Description: ${COMPANY_METADATA.description}
Core Services: ${COMPANY_METADATA.coreServices.join(', ')}
Key Strengths: ${COMPANY_METADATA.keyStrengths.join(', ')}
Recent Achievements: ${COMPANY_METADATA.recentAchievements.join(', ')}

CURRENT MEETING:
Title: ${currentEvent.summary}
Date: ${currentEvent.startTime}
Location: ${currentEvent.location}
Description: ${currentEvent.description || 'No description provided'}
Meeting Type: ${meetingType}

PREVIOUS ENGAGEMENTS:
${previousMeetings.map((meeting, index) => `
Meeting ${index + 1}: ${meeting.metadata.summary}
Date: ${meeting.metadata.startTime}
Notes: ${meeting.pageContent.slice(0, 1000)}...
`).join('\n') || 'No previous meetings found.'}

EXTERNAL RESEARCH:
Search Query: ${externalResearch?.searchQuery || 'None'}
Company News: ${externalResearch?.companyNews || 'No external news found.'}
Contact Updates: ${externalResearch?.contactUpdates || 'No contact updates found.'}

Return ONLY a JSON object in this exact format:
{
  "meetingType": "${meetingType}",
  "clientOverview": "Brief overview of the client and project",
  "pastEngagementSummary": "Summary of previous meetings and progress",
  "currentProjectStatus": "Current status and context of the project",
  "externalIntelligence": "Relevant external news and insights",
  "recommendedTalkingPoints": [
    "Specific talking point that connects our services to client needs",
    "Another actionable talking point"
  ],
  "keyQuestions": [
    "Strategic question to ask during the meeting",
    "Another important question"
  ],
  "riskFactors": [
    "Potential risk or concern to address",
    "Another risk factor"
  ],
  "opportunities": [
    "Business opportunity to explore",
    "Another potential opportunity"
  ]
}

Focus on:
- Actionable intelligence, not generic information
- Connecting external news to our service offerings
- Specific questions that demonstrate understanding
- Tailoring content to the meeting type (${meetingType})
- Highlighting how our company's strengths align with client needs
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const raw = await result.response.text();
    const parsed: MeetingSummary = JSON.parse(
      raw.trim().replace(/^```json/, '').replace(/```$/, '')
    );

    // Generate the formatted summary document
    const formattedSummary = formatSummaryDocument(parsed, currentEvent, projectName);

    console.log('✅ Meeting summary generated successfully');
    console.log('📄 Summary preview:');
    console.log(formattedSummary.slice(0, 500) + '...');

    return {
      ...state,
      summary: formattedSummary,
    };
  } catch (error) {
    console.error('❌ Error generating meeting summary:', error);
    
    // Fallback summary
    const fallbackSummary = generateFallbackSummary(currentEvent, previousMeetings, externalResearch);
    
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

function formatSummaryDocument(
  summary: MeetingSummary, 
  currentEvent: CalendarEvent, 
  projectName: string
): string {
  const date = new Date(currentEvent.startTime).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
# PRE-CALL BRIEFING DOCUMENT

**Meeting:** ${currentEvent.summary}  
**Date:** ${date}  
**Location:** ${currentEvent.location}  
**Meeting Type:** ${summary.meetingType.toUpperCase()}  
**Prepared by:** Cprime AI Assistant

---

## 🏢 CLIENT OVERVIEW

${summary.clientOverview}

---

## 📊 PROJECT STATUS & HISTORY

### Past Engagement Summary
${summary.pastEngagementSummary}

### Current Project Status  
${summary.currentProjectStatus}

---

## 🌐 EXTERNAL INTELLIGENCE

${summary.externalIntelligence}

---

## 🎯 RECOMMENDED TALKING POINTS

${summary.recommendedTalkingPoints.map((point, index) => `${index + 1}. ${point}`).join('\n')}

---

## ❓ KEY QUESTIONS TO ASK

${summary.keyQuestions.map((question, index) => `${index + 1}. ${question}`).join('\n')}

---

## ⚠️ RISK FACTORS TO ADDRESS

${summary.riskFactors.map((risk, index) => `• ${risk}`).join('\n')}

---

## 🚀 OPPORTUNITIES TO EXPLORE

${summary.opportunities.map((opp, index) => `• ${opp}`).join('\n')}

---

## 🏭 CPRIME VALUE PROPOSITION

**Core Services Alignment:**
${COMPANY_METADATA.coreServices.map(service => `• ${service}`).join('\n')}

**Key Differentiators:**
${COMPANY_METADATA.keyStrengths.map(strength => `• ${strength}`).join('\n')}

**Recent Achievements:**
${COMPANY_METADATA.recentAchievements.map(achievement => `• ${achievement}`).join('\n')}

---

## 📋 MEETING PREPARATION CHECKLIST

- [ ] Review previous meeting notes and action items
- [ ] Prepare technical diagrams/proposals if needed
- [ ] Confirm attendee list and roles
- [ ] Prepare answers for potential technical questions
- [ ] Review competitive landscape insights
- [ ] Prepare follow-up action items template

---

*Generated on ${new Date().toISOString().split('T')[0]} | Confidential - Internal Use Only*
`;
}

function generateFallbackSummary(
  event: CalendarEvent, 
  previousMeetings: RetrievedMeeting[], 
  externalResearch?: { searchQuery?: string; companyNews?: string; contactUpdates?: string }
): string {
  const date = new Date(event.startTime).toLocaleDateString();
  
  return `
# PRE-CALL BRIEFING DOCUMENT

**Meeting:** ${event.summary}  
**Date:** ${date}  
**Location:** ${event.location}

## Meeting Context
This appears to be a ${previousMeetings.length > 0 ? 'follow-up' : 'initial'} meeting regarding ${event.summary}.

## Previous Engagements
${previousMeetings.length > 0 
  ? `We have had ${previousMeetings.length} previous meeting(s) with this client.`
  : 'This appears to be our first formal meeting with this client.'
}

## External Intelligence
${externalResearch?.companyNews || 'Limited external information available.'}

## Recommended Approach
- Focus on understanding client needs and current challenges
- Present relevant Cprime solutions and case studies
- Establish clear next steps and follow-up actions

---
*Fallback summary generated - Limited data available*
`;
}