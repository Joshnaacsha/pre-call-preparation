import OpenAI from 'openai';
import dotenv from 'dotenv';
import type { GraphState, CalendarEvent, RetrievedMeeting } from '../graph/graphState.js';
import { embedAndStoreEvent } from '../embeddings/embedAndStore.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
throw new Error('OPENAI_API_KEY environment variable is not set');
}

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

interface KeyStakeholder {
  name: string;
  title: string;
  focus_area: string;
  background?: string;
  decision_authority?: string;
}

import { CaseStudy } from '../graph/graphState.js';

interface SalesIntelligenceReport {
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
}

interface MeetingSummary {
  meetingType: 'discovery' | 'follow-up' | 'proposal' | 'execution-review' | 'other';
  clientContext: string;
  pastEngagement: string;
  externalIntelligence: string;
  talkingPoints: string[];
  keyQuestions: string[];
  risks: string[];
  opportunities: string[];
  salesIntelligence: SalesIntelligenceReport;
  nextSteps: string[];
  competitiveThreats: string[];
}

class SummaryGenerationError extends Error {
  constructor(message: string, public readonly code: string, public readonly details?: any) {
    super(message);
    this.name = 'SummaryGenerationError';
  }
}

/**
 * Deep research module - extracts comprehensive company intelligence
 */
async function conductDeepResearch(
  clientName: string,
  externalResearch: any
): Promise<Partial<SalesIntelligenceReport>> {
  const researchPrompt = `
You are a senior sales intelligence analyst. Analyze the following research data about ${clientName} and extract SPECIFIC, ACTIONABLE intelligence.

RESEARCH DATA:
${externalResearch?.companyNews || 'No company news available'}

INSTRUCTIONS:
1. Extract ONLY verifiable facts - no speculation
2. Identify specific numbers, dates, initiatives, and quotes
3. Focus on actionable sales opportunities
4. Identify decision-maker pain points
5. Note competitive pressures and market dynamics

Return a JSON object with these fields (use "Data not available" if information is missing):
{
  "financialPerformance": "Specific revenue, funding, growth metrics with sources",
  "leadershipOrganization": "Key executives with titles and responsibilities",
  "strategicInitiatives": "Specific projects, transformations, and technology investments",
  "challengesPainPoints": "Explicit problems, bottlenecks, and urgent needs",
  "marketPosition": "Competitive standing, market share, industry trends affecting them",
  "citations": ["Source 1", "Source 2"]
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: researchPrompt }],
      temperature: 0.3, // Lower temperature for factual extraction
    });

    const content = response.choices[0].message.content || '{}';
    const jsonMatch = content.match(/```(?:json)?([\s\S]*?)```/) || content.match(/({[\s\S]*})/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    
    return {};
  } catch (error) {
    console.error('[Error] Deep research failed:', error);
    return {};
  }
}

/**
 * Stakeholder intelligence module - analyzes decision makers
 */
async function analyzeStakeholders(
  attendees: string[],
  contactResearch: string,
  clientName: string
): Promise<KeyStakeholder[]> {
  if (!attendees?.length || !contactResearch || 
      contactResearch.includes('No attendee profile') ||
      contactResearch.length < 100) {
    return [];
  }

  const stakeholderPrompt = `
Analyze these meeting attendees and research to identify key stakeholders:

ATTENDEES: ${attendees.join(', ')}
RESEARCH: ${contactResearch}

For EACH attendee, extract:
1. Full name
2. Job title
3. Focus areas / responsibilities
4. Background (education, experience, previous roles)
5. Decision authority level (Budget Owner / Technical Evaluator / Influencer / End User)

Return a JSON array:
[
  {
    "name": "Full Name",
    "title": "Exact Job Title",
    "focus_area": "Primary responsibilities and interests",
    "background": "Relevant education/experience",
    "decision_authority": "Budget Owner | Technical Evaluator | Influencer | End User"
  }
]

Only include attendees with verifiable information. Return empty array [] if no data available.
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: stakeholderPrompt }],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || '[]';
    const jsonMatch = content.match(/```(?:json)?([\s\S]*?)```/) || content.match(/(\[[\s\S]*\])/);
    
    if (jsonMatch) {
      const stakeholders = JSON.parse(jsonMatch[1].trim());
      return Array.isArray(stakeholders) ? stakeholders : [];
    }
    
    return [];
  } catch (error) {
    console.error('[Error] Stakeholder analysis failed:', error);
    return [];
  }
}

/**
 * Sales strategy module - generates tactical recommendations
 */
async function generateSalesStrategy(
  clientContext: string,
  intelligence: Partial<SalesIntelligenceReport>,
  previousMeetings: RetrievedMeeting[],
  meetingType: string
): Promise<{
  salesOpportunities: string;
  riskFactors: string;
  recommendedApproach: string;
  talkingPoints: string[];
  keyQuestions: string[];
  nextSteps: string[];
}> {
  const strategyPrompt = `
You are a senior sales strategist preparing for a ${meetingType} meeting.

CLIENT CONTEXT:
${clientContext}

INTELLIGENCE GATHERED:
Financial: ${intelligence.financialPerformance || 'Limited data'}
Challenges: ${intelligence.challengesPainPoints || 'Unknown'}
Initiatives: ${intelligence.strategicInitiatives || 'Unknown'}
Market Position: ${intelligence.marketPosition || 'Unknown'}

ENGAGEMENT HISTORY: ${previousMeetings.length} previous touchpoints

Generate a tactical sales strategy in JSON format:
{
  "salesOpportunities": "3-4 specific opportunities based on their challenges and our capabilities. Be precise about WHERE we can add value.",
  "riskFactors": "3-4 potential objections, competitive threats, or deal blockers we should prepare for",
  "recommendedApproach": "Step-by-step strategy for THIS meeting. What to lead with, what to avoid, how to position our value.",
  "talkingPoints": [
    "Talking point 1 - specific, tied to their challenges",
    "Talking point 2 - quantifiable ROI or outcome",
    "Talking point 3 - competitive differentiation",
    "Talking point 4 - case study or proof point"
  ],
  "keyQuestions": [
    "Discovery question 1 - uncover technical challenges",
    "Discovery question 2 - identify budget and timeline",
    "Discovery question 3 - understand decision process",
    "Discovery question 4 - qualify urgency and priority"
  ],
  "nextSteps": [
    "Immediate action 1 - for this meeting",
    "Follow-up action 2 - after this meeting",
    "Long-term action 3 - to advance the deal"
  ]
}

Make everything SPECIFIC and ACTIONABLE. Avoid generic advice.
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: strategyPrompt }],
      temperature: 0.5,
    });

    const content = response.choices[0].message.content || '{}';
    const jsonMatch = content.match(/```(?:json)?([\s\S]*?)```/) || content.match(/({[\s\S]*})/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
  } catch (error) {
    console.error('[Error] Sales strategy generation failed:', error);
  }

  // Fallback strategy
  return {
    salesOpportunities: "Opportunity discovery needed - focus on understanding their technology stack and pain points.",
    riskFactors: "Unknown budget, timeline, and decision process. Competitive landscape unclear.",
    recommendedApproach: "Lead with discovery questions. Establish credibility through case studies. Identify technical and business decision makers.",
    talkingPoints: [
      "Our proven cloud migration methodology reduces risk and accelerates time-to-value",
      "AWS Advanced Consulting Partner with 100+ successful migrations",
      "End-to-end DevOps implementation improving deployment frequency by 10x",
      "Local presence in Chennai with global delivery capabilities"
    ],
    keyQuestions: [
      "What specific technical challenges are you facing with your current infrastructure?",
      "What's driving the timeline for this initiative?",
      "Who are the key stakeholders involved in evaluating and approving this project?",
      "What does success look like for this initiative - what metrics matter most?"
    ],
    nextSteps: [
      "Document current state architecture and pain points",
      "Schedule technical deep-dive with engineering team",
      "Share relevant case studies from similar industry/scale"
    ]
  };
}

/**
 * Main meeting summary generator with enhanced intelligence
 */
export async function generateMeetingSummary(state: GraphState): Promise<GraphState> {
  try {
    if (!state.calendarEvents || state.calendarEvents.length === 0) {
      throw new SummaryGenerationError('No calendar events found', 'NO_EVENTS');
    }

    const currentEvent = state.calendarEvents[0];
    const clientName = currentEvent.summary.split('-')[0].trim();
    const projectName = currentEvent.summary.replace(/\(.*?\)/g, '').trim();
    
    console.log(`[Info] Generating enhanced summary for: ${clientName}`);

    // Stage 1: Deep research
    console.log('[Stage 1] Conducting deep research...');
    const deepResearch = await conductDeepResearch(
      clientName,
      state.externalResearch
    );

    // Stage 2: Stakeholder analysis
    console.log('[Stage 2] Analyzing stakeholders...');
    const stakeholders = await analyzeStakeholders(
      currentEvent.attendees || [],
      state.externalResearch?.contactUpdates || '',
      clientName
    );

    // Stage 3: Generate sales strategy
    console.log('[Stage 3] Generating sales strategy...');
    const previousMeetings = state.previousMeetingsByProject?.[currentEvent.summary] || [];
    const meetingType = determineMeetingType(currentEvent, previousMeetings);
    
    const clientContext = generateClientContext(
      currentEvent,
      previousMeetings,
      state.projectNotesFromDB?.[projectName] || []
    );

    const salesStrategy = await generateSalesStrategy(
      clientContext,
      deepResearch,
      previousMeetings,
      meetingType
    );

    // Stage 4: Compile comprehensive intelligence report
    const salesIntelligence: SalesIntelligenceReport = {
      companyName: clientName,
      executiveSummary: generateExecutiveSummary(deepResearch, salesStrategy, stakeholders),
      financialPerformance: deepResearch.financialPerformance || 'Financial data not available',
      leadershipOrganization: deepResearch.leadershipOrganization || 'Leadership information not available',
      strategicInitiatives: deepResearch.strategicInitiatives || 'Strategic initiatives not available',
      challengesPainPoints: deepResearch.challengesPainPoints || 'Challenges not yet identified',
      marketPosition: deepResearch.marketPosition || 'Market position analysis pending',
      salesOpportunities: salesStrategy.salesOpportunities,
      riskFactors: salesStrategy.riskFactors,
      keyStakeholders: Array.isArray(stakeholders) ? stakeholders : [],
      recommendedApproach: salesStrategy.recommendedApproach,
      confidenceScore: calculateEnhancedConfidenceScore(deepResearch, stakeholders, state),
      citations: deepResearch.citations || [],
      // Case studies are now part of ExternalResearchResult
    };

    const summary: MeetingSummary = {
      meetingType,
      clientContext,
      pastEngagement: generatePastEngagement(previousMeetings, state.projectNotesFromDB?.[projectName]),
      externalIntelligence: formatExternalIntelligence(state.externalResearch),
      talkingPoints: salesStrategy.talkingPoints,
      keyQuestions: salesStrategy.keyQuestions,
      risks: (salesStrategy.riskFactors || '').split('\n').filter(r => r?.trim?.()),
      opportunities: (salesStrategy.salesOpportunities || '').split('\n').filter(o => o?.trim?.()),
      salesIntelligence,
      nextSteps: salesStrategy.nextSteps,
      competitiveThreats: extractCompetitiveThreats(state.externalResearch)
    };

    // Format and store
    const formattedSummary = formatEnhancedSummary(summary, currentEvent, projectName, state);

    try {
      await embedAndStoreEvent({
        ...currentEvent,
        description: formattedSummary,
        metadata: {
          client_name: clientName,
          project_name: projectName,
          meeting_goal: summary.clientContext,
          raw_summary: summary
        }
      });
      console.log('[Success] Enhanced summary stored in database');
    } catch (error) {
      console.error('[Error] Failed to store summary:', error);
    }

    return {
      ...state,
      summary: formattedSummary,
      calendarEvents: state.calendarEvents
    };

  } catch (error) {
    console.error('[Error] Enhanced summary generation failed:', error);
    
    // Better fallback with partial intelligence
    return {
      ...state,
      summary: generateIntelligentFallback(
        state.calendarEvents[0],
        state.previousMeetingsByProject?.[state.calendarEvents[0].summary] || [],
        state.externalResearch,
        state
      ),
    };
  }
}

// Helper functions

function generateClientContext(
  event: CalendarEvent,
  previousMeetings: RetrievedMeeting[],
  projectNotes: string[]
): string {
  const stage = previousMeetings.length === 0 ? 'New prospect' : 
                previousMeetings.length < 3 ? 'Early stage qualification' :
                previousMeetings.length < 6 ? 'Active opportunity' : 'Advanced negotiations';
  
  const context = [`${stage} - ${event.summary}`];
  
  if (projectNotes.length > 0) {
    context.push(`CRM shows ${projectNotes.length} notes indicating active engagement.`);
  }
  
  if (previousMeetings.length > 0) {
    const lastMeeting = previousMeetings[0];
    context.push(`Last meeting: ${lastMeeting.metadata?.summary || 'Previous discussion'} covered initial requirements.`);
  }
  
  return context.join(' ');
}

function generatePastEngagement(
  meetings: RetrievedMeeting[],
  notes?: string[]
): string {
  if (meetings.length === 0 && (!notes || notes.length === 0)) {
    return 'First engagement - no prior meeting history or CRM data.';
  }
  
  const engagement = [];
  
  if (meetings.length > 0) {
    engagement.push(`${meetings.length} previous meetings documented.`);
    const recentTopics = meetings.slice(0, 2).map(m => 
      m.metadata?.summary || m.pageContent.slice(0, 100)
    ).join('; ');
    engagement.push(`Recent discussions: ${recentTopics}`);
  }
  
  if (notes && notes.length > 0) {
    engagement.push(`${notes.length} CRM entries tracking progress and action items.`);
  }
  
  return engagement.join(' ');
}

function formatExternalIntelligence(research: any): string {
  if (!research) return 'No external research conducted.';
  
  const intel = [];
  
  if (research.companyNews && research.companyNews.length > 50) {
    intel.push('Recent company developments and market activity analyzed.');
  }
  
  if (research.contactUpdates && !research.contactUpdates.includes('No attendee')) {
    intel.push('Stakeholder profiles and decision-maker intelligence gathered.');
  }
  
  return intel.length > 0 ? intel.join(' ') : 'Limited external intelligence available.';
}

function extractCompetitiveThreats(research: any): string[] {
  // Extract mentions of competitors or alternative solutions
  const threats: string[] = [];
  const content = JSON.stringify(research || {}).toLowerCase();
  
  const competitors = ['aws', 'azure', 'gcp', 'accenture', 'deloitte', 'infosys', 'tcs', 'wipro'];
  competitors.forEach(comp => {
    if (content.includes(comp)) {
      threats.push(`${comp.toUpperCase()} presence detected`);
    }
  });
  
  return threats.length > 0 ? threats : ['Competitive landscape unclear - research needed'];
}

function generateExecutiveSummary(
  research: Partial<SalesIntelligenceReport>,
  strategy: any,
  stakeholders: KeyStakeholder[]
): string {
  const components = [];
  
  // Helper function to safely get first sentence
  const getFirstSentence = (text: string | undefined | null): string | null => {
    if (!text || typeof text !== 'string') return null;
    const sentences = text.split('.')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    return sentences[0] || null;
  };
  
  // Add strategic initiatives if available
  const initiativesSentence = getFirstSentence(research?.strategicInitiatives);
  if (initiativesSentence && !initiativesSentence.toLowerCase().includes('not available')) {
    components.push(initiativesSentence);
  }
  
  // Add stakeholder information if available
  if (Array.isArray(stakeholders) && stakeholders.length > 0) {
    components.push(`Meeting with ${stakeholders.length} key decision maker(s)`);
  }
  
  // Add sales opportunities if available
  const opportunitiesSentence = getFirstSentence(strategy?.salesOpportunities);
  if (opportunitiesSentence) {
    components.push(opportunitiesSentence);
  }
  
  return components.join('. ') + '.';
}

function calculateEnhancedConfidenceScore(
  research: Partial<SalesIntelligenceReport>,
  stakeholders: KeyStakeholder[],
  state: GraphState
): number {
  let score = 0;
  
  // Research quality (40%)
  if (research.financialPerformance && !research.financialPerformance.includes('not available')) score += 0.1;
  if (research.strategicInitiatives && !research.strategicInitiatives.includes('not available')) score += 0.1;
  if (research.challengesPainPoints && !research.challengesPainPoints.includes('not identified')) score += 0.1;
  if (research.marketPosition && !research.marketPosition.includes('pending')) score += 0.1;
  
  // Stakeholder intelligence (30%)
  if (stakeholders.length > 0) score += 0.15;
  if (stakeholders.some(s => s.decision_authority?.includes('Budget Owner'))) score += 0.15;
  
  // Historical context (30%)
  const meetings = Object.values(state.previousMeetingsByProject || {}).flat();
  if (meetings.length > 0) score += 0.1;
  if (meetings.length > 3) score += 0.1;
  if (state.projectNotesFromDB && Object.keys(state.projectNotesFromDB).length > 0) score += 0.1;
  
  return Math.min(score, 1.0);
}

function determineMeetingType(event: CalendarEvent, previousMeetings: RetrievedMeeting[]): 'discovery' | 'follow-up' | 'proposal' | 'execution-review' | 'other' {
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

function formatEnhancedSummary(
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

  const intel = summary.salesIntelligence;
  const score = Math.round(intel.confidenceScore * 100);

  return `# 🎯 SALES INTELLIGENCE BRIEFING

## Meeting Overview
**${currentEvent.summary}**  
${date} | ${currentEvent.location || 'Virtual'} | Stage: ${summary.meetingType.toUpperCase()}

**Attendees:** ${currentEvent.attendees?.join(', ') || 'TBD'}  
**Intelligence Confidence:** ${score}% | **Sources:** ${intel.citations?.length || 0}

---

## 📊 EXECUTIVE SUMMARY

${intel.executiveSummary}

**Deal Status:** ${summary.pastEngagement}

---

## 🎯 TACTICAL OBJECTIVES FOR THIS MEETING

### Primary Talking Points
${summary.talkingPoints.map((point, i) => `${i + 1}. **${point}**`).join('\n')}

### Critical Discovery Questions
${summary.keyQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

### Immediate Next Steps
${summary.nextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

---

## 🏢 COMPANY INTELLIGENCE

### Financial & Market Position
${intel.financialPerformance}

**Market Standing:** ${intel.marketPosition}

### Leadership & Organization
${intel.leadershipOrganization}

### Strategic Initiatives & Technology Priorities
${intel.strategicInitiatives}

---

## 👥 KEY STAKEHOLDERS & DECISION MAKERS

${intel.keyStakeholders.length > 0 ? 
  intel.keyStakeholders.map(s => `
### ${s.name} - ${s.title}
- **Focus Areas:** ${s.focus_area}
${s.background ? `- **Background:** ${s.background}` : ''}
${s.decision_authority ? `- **Role in Decision:** ${s.decision_authority}` : ''}
`).join('\n') : 
  '⚠️ Stakeholder intelligence limited - prioritize identifying decision makers in this meeting'}

---

## 💡 SALES OPPORTUNITIES

${intel.salesOpportunities}

### Challenges We Can Solve
${intel.challengesPainPoints}

### Recommended Sales Approach
${intel.recommendedApproach}

---

## ⚠️ RISKS & COMPETITIVE THREATS

**Deal Risks:**
${summary.risks.map(r => `- ${r}`).join('\n')}

**Competitive Intelligence:**
${summary.competitiveThreats.map(t => `- ${t}`).join('\n')}

---

## 📚 RELEVANT CASE STUDIES

${intel.cprimeCaseStudies && intel.cprimeCaseStudies.length > 0 ?
  intel.cprimeCaseStudies.slice(0, 3).map(study => `
### ${study.title}
**Industry:** ${study.industry} | **Relevance:** ${study.relevanceScore}/10

${study.description}

**Technologies:** ${study.technologies?.join(', ') || 'Not specified'}  
**Why Relevant:** ${study.relevance_reasoning}  

${study.url ? `[Full Case Study](${study.url})` : ''}
`).join('\n') :
  '⚠️ No perfectly matched case studies - prepare to discuss similar engagements'
}

---

## 🚀 CPRIME VALUE PROPOSITION

**Core Capabilities:** ${COMPANY_METADATA.coreServices.join(' | ')}

**Competitive Advantages:**
${COMPANY_METADATA.keyDifferentiators.map(d => `- ${d}`).join('\n')}

---

## 📈 ENGAGEMENT METRICS

- **Meeting #${(state.previousMeetingsByProject?.[currentEvent.summary]?.length || 0) + 1}** in this sales cycle
- **CRM Activity:** ${Object.keys(state.projectNotesFromDB || {}).length} project notes
- **Research Depth:** ${intel.citations.length} sources analyzed
- **Decision Maker Access:** ${intel.keyStakeholders.filter(s => s.decision_authority?.includes('Budget Owner')).length} budget owners identified

---

*🔒 Confidential Sales Intelligence | Generated ${new Date().toISOString().split('T')[0]}*  
*⚡ Powered by AI-Enhanced Sales Research | Cprime Technologies*
`;
}

function generateIntelligentFallback(
  event: CalendarEvent,
  previousMeetings: RetrievedMeeting[],
  externalResearch?: any,
  state?: GraphState
): string {
  const clientName = event.summary.split('-')[0].trim();
  const attendeesInfo = event.attendees?.length 
    ? `Confirmed Attendees: ${event.attendees.join(', ')}`
    : 'No attendees confirmed yet - identify key stakeholders during the call';
  
  // Extract any available research snippets
  const researchSnippets = externalResearch ? {
    companyNews: typeof externalResearch.companyNews === 'string' ? externalResearch.companyNews.slice(0, 200) : null,
    contactInfo: typeof externalResearch.contactUpdates === 'string' ? externalResearch.contactUpdates.slice(0, 200) : null,
  } : null;

  // Determine meeting phase based on previous interactions
  const meetingPhase = previousMeetings.length === 0 ? 'Initial Discovery'
    : previousMeetings.length === 1 ? 'Follow-up Discovery'
    : previousMeetings.length < 4 ? 'Solution Development'
    : 'Advanced Stage';

  return `# 🎯 SALES BRIEFING (Partial Intelligence)

## ${event.summary}
**Phase:** ${meetingPhase}
${attendeesInfo}

**⚠️ Research Status:** Limited data available - conducting live discovery

${researchSnippets?.companyNews ? `
### Recent Company Intelligence
${researchSnippets.companyNews}...
` : ''}

${researchSnippets?.contactInfo ? `
### Stakeholder Information
${researchSnippets.contactInfo}...
` : ''}

### Key Objectives for This Meeting:
1. **Map Current State:**
   - Technology landscape and infrastructure
   - Pain points and business challenges
   - Current solutions and their limitations

2. **Identify Opportunities:**
   - Cost optimization potential
   - Process improvement areas
   - Digital transformation needs

3. **Understand Decision Framework:**
   - Budget availability and fiscal cycle
   - Decision makers and influencers
   - Evaluation criteria and timeline
   - Competitors or alternative solutions being considered

### Industry-Specific Discussion Points:
1. **Digital Transformation Trends:**
   - Cloud adoption and modernization
   - DevOps and automation opportunities
   - Security and compliance requirements

2. **Value Proposition Alignment:**
   - ROI expectations and measurement
   - Implementation timeline preferences
   - Support and maintenance needs

### Our Relevant Capabilities:
**Core Services:**
${COMPANY_METADATA.coreServices.map(service => `- ${service}
  - Use Cases
  - Success Metrics
  - Client References`).join('\n')}

**Key Differentiators:**
${COMPANY_METADATA.keyDifferentiators.map(diff => `- ${diff}`).join('\n')}

### Critical Discovery Questions:
1. **Business Context:**
   - What business objectives are driving your interest in our solutions?
   - How do you measure success for this initiative?
   - What's the timeline for implementation?

2. **Technical Assessment:**
   - What's your current technology stack?
   - What integration requirements do you have?
   - What security and compliance needs must be addressed?

3. **Stakeholder Mapping:**
   - Who else needs to be involved in the evaluation?
   - What's the typical decision-making process for similar projects?
   - Are there any specific requirements from different departments?

### Immediate Next Steps:
1. Document all requirements and challenges identified
2. Map key stakeholders and their priorities
3. Schedule technical deep-dive session
4. Prepare tailored solution proposal
5. Share relevant case studies and references

**Meeting Date:** ${new Date(event.startTime).toLocaleDateString()}
**Previous Interactions:** ${previousMeetings.length}
**Confidence Score:** ${previousMeetings.length ? '35%' : '25%'} (Active Discovery Phase)

*This is a dynamic document - update with findings during the meeting*
`;
}