import dotenv from "dotenv";
import dayjs from "dayjs";
import { OpenAI } from "openai";
import type { GraphState, CalendarEvent } from '../graph/graphState.js';

dotenv.config();

interface PersonProfile {
  email: string;
  domain: string;
  summary: string;
  timestamp: string;
  verified: boolean;
  sourceCount?: number;
}

interface LinkedInResearchResult {
  searchQuery: string;
  profiles: PersonProfile[];
  totalAttendeesResearched: number;
  internalAttendees: string[];
  externalAttendees: string[];
}

class ProfessionalResearcher {
  private client: OpenAI;
  private model = "gpt-4o";

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async researchPerson(email: string): Promise<PersonProfile> {
    try {
      const domain = email.split('@')[1];
      const prompt = this.buildResearchPrompt(email, domain);

      console.log(`   🔍 Researching: ${email}`);

      const chatResponse = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are a professional researcher that provides accurate and verified information from publicly available professional sources."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1500,
      });

      const summary = chatResponse.choices[0]?.message?.content || "No response from model.";
      
      // Check if the response indicates no information was found
      const verified = !summary.includes("No verifiable professional information found");

      return {
        email,
        domain,
        summary,
        timestamp: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        verified,
        sourceCount: verified ? this.countSources(summary) : 0,
      };

    } catch (error: any) {
      console.error(`   ❌ Error researching ${email}: ${error.message}`);
      return {
        email,
        domain: email.split('@')[1] || 'unknown',
        summary: `Research failed: ${error.message}`,
        timestamp: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        verified: false,
      };
    }
  }

  private countSources(summary: string): number {
    const sourceMatches = summary.match(/Source \d+:/g);
    return sourceMatches ? sourceMatches.length : 1;
  }

  private buildResearchPrompt(nameOrEmail: string, domain: string): string {
    return `
Conduct professional profile research for: ${nameOrEmail}

RESEARCH GUIDELINES:
1. Search across professional networks (LinkedIn, company websites, directories)
2. Focus on CURRENT and RECENT information (last 2-3 years)
3. Verify information from professional sources only
4. If information cannot be verified, clearly state "No verifiable information found"
5. Keep response concise but comprehensive

SEARCH FOCUS (prioritize current information):
- Current position and company
- Recent professional achievements
- Key skills and expertise relevant to business meetings
- Educational background (if relevant to current role)
- Industry recognition or leadership positions

RESPONSE FORMAT (CONCISE - max 800 words):

**CURRENT PROFESSIONAL PROFILE**
• Full Name: [if determinable]
• Current Position: [title at company]
• Company: [current employer]
• Industry: [business sector]
• Location: [city/region if professional context]

**ROLE & EXPERTISE**
• Key Responsibilities: [2-3 main areas]
• Areas of Expertise: [relevant skills/technologies]
• Team/Department: [if known]
• Years of Experience: [approximate if determinable]

**RECENT ACHIEVEMENTS** (if found)
• Notable projects or accomplishments
• Industry recognition
• Leadership roles

**BUSINESS CONTEXT**
• Company size and focus
• Industry trends affecting their role
• Potential decision-making authority
• Relevant technologies/platforms they work with

**MEETING RELEVANCE**
Based on their profile, suggest:
• Key topics they might be interested in
• Their likely role in decision-making
• Potential pain points in their industry/role

If no current professional information found, respond with:
"No verifiable current professional information found for: ${nameOrEmail}"

Focus on information that would be valuable for business meeting preparation.
`;
  }
}

export async function conductLinkedInResearch(state: GraphState): Promise<GraphState> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("your_api_key")) {
    console.warn('⚠️ OPENAI_API_KEY not configured - skipping LinkedIn research');
    return {
      ...state,
      externalResearch: {
        contactUpdates: 'LinkedIn research skipped - OpenAI API key not configured',
        searchQuery: 'LinkedIn research skipped - API key not configured',
      }
    };
  }

  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.warn('⚠️ No calendar events found for LinkedIn research');
    return state;
  }

  const currentEvent = state.calendarEvents[0];
  const researcher = new ProfessionalResearcher(apiKey);
  
  console.log('🔗 Starting LinkedIn/Professional research...');
  console.log(`   📧 Meeting attendees: ${currentEvent.attendees.length}`);

  // Filter attendees - skip internal Cprime emails
  const internalDomains = ['cprime.com', 'licet.ac.in']; // Add your internal domains
  const externalAttendees = currentEvent.attendees.filter(email => 
    !internalDomains.some(domain => email.toLowerCase().includes(domain.toLowerCase()))
  );
  
  const internalAttendees = currentEvent.attendees.filter(email => 
    internalDomains.some(domain => email.toLowerCase().includes(domain.toLowerCase()))
  );

  console.log(`   👥 External attendees to research: ${externalAttendees.length}`);
  console.log(`   🏢 Internal attendees (skipped): ${internalAttendees.length}`);

  if (externalAttendees.length === 0) {
    console.log('   ✅ No external attendees to research');
    return {
      ...state,
      externalResearch: {
        contactUpdates: 'No external attendees found for research',
        searchQuery: `Professional research: ${currentEvent.summary}`,
      }
    };
  }

  const profiles: PersonProfile[] = [];
  
  // Research each external attendee
  for (const email of externalAttendees.slice(0, 5)) { // Limit to first 5 to avoid API costs
    try {
      const profile = await researcher.researchPerson(email);
      profiles.push(profile);
      
      if (profile.verified) {
        console.log(`   ✅ Research completed: ${email}`);
      } else {
        console.log(`   ⚠️ Limited info found: ${email}`);
      }
      
      // Add delay to be respectful to API limits
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`   ❌ Failed to research ${email}:`, error);
    }
  }

  // Generate consolidated research summary
  const researchSummary = generateResearchSummary(profiles, currentEvent);
  
  console.log(`✅ LinkedIn research completed: ${profiles.length} profiles researched`);
  console.log(`   📊 Verified profiles: ${profiles.filter(p => p.verified).length}`);

  return {
    ...state,
    externalResearch: {
      contactUpdates: researchSummary,
      searchQuery: state.externalResearch?.searchQuery || `Professional research: ${currentEvent.summary}`,
    }
  };
}

function generateResearchSummary(profiles: PersonProfile[], event: CalendarEvent): string {
  const verifiedProfiles = profiles.filter(p => p.verified);
  const unverifiedCount = profiles.length - verifiedProfiles.length;

  if (verifiedProfiles.length === 0) {
    return `Professional research conducted for ${profiles.length} attendee(s) - limited public information available. Meeting: ${event.summary}`;
  }

  let summary = `**ATTENDEE INTELLIGENCE** (${verifiedProfiles.length} profiles researched)\n\n`;

  verifiedProfiles.forEach((profile, index) => {
    const domain = profile.domain;
    const companyInfo = extractCompanyInfo(profile.summary);
    const roleInfo = extractRoleInfo(profile.summary);
    
    summary += `**${index + 1}. ${profile.email}**\n`;
    summary += `• Company/Domain: ${companyInfo || domain}\n`;
    summary += `• Role: ${roleInfo || 'Position not specified'}\n`;
    
    // Extract key insights from the profile
    const keyInsights = extractKeyInsights(profile.summary);
    if (keyInsights.length > 0) {
      summary += `• Key Context: ${keyInsights.join(' • ')}\n`;
    }
    
    summary += '\n';
  });

  if (unverifiedCount > 0) {
    summary += `*Note: ${unverifiedCount} additional attendee(s) researched with limited public information available.*\n\n`;
  }

  // Add meeting context suggestions
  summary += generateMeetingContextSuggestions(verifiedProfiles);

  summary += `\n*Research conducted: ${dayjs().format("MMM DD, YYYY HH:mm")} | Sources: Professional directories and public profiles*`;

  return summary;
}

function extractCompanyInfo(summary: string): string | null {
  const companyMatch = summary.match(/Company:\s*([^\n•]+)/i);
  return companyMatch ? companyMatch[1].trim() : null;
}

function extractRoleInfo(summary: string): string | null {
  const roleMatch = summary.match(/Current Position:\s*([^\n•]+)/i) || 
                   summary.match(/Job Title:\s*([^\n•]+)/i);
  return roleMatch ? roleMatch[1].trim() : null;
}

function extractKeyInsights(summary: string): string[] {
  const insights: string[] = [];
  
  // Extract industry
  const industryMatch = summary.match(/Industry:\s*([^\n•]+)/i);
  if (industryMatch) insights.push(industryMatch[1].trim());
  
  // Extract key expertise
  const expertiseMatch = summary.match(/Areas of Expertise:\s*([^\n•]+)/i);
  if (expertiseMatch) insights.push(`Expertise: ${expertiseMatch[1].trim()}`);
  
  // Extract decision making context
  if (summary.includes('Director') || summary.includes('Manager') || summary.includes('VP') || summary.includes('Head')) {
    insights.push('Likely decision maker');
  }
  
  return insights.slice(0, 3); // Keep it concise
}

function generateMeetingContextSuggestions(profiles: PersonProfile[]): string {
  const industries = new Set<string>();
  const seniorities = new Set<string>();
  
  profiles.forEach(profile => {
    const industryMatch = profile.summary.match(/Industry:\s*([^\n•]+)/i);
    if (industryMatch) industries.add(industryMatch[1].trim());
    
    if (profile.summary.includes('Director') || profile.summary.includes('VP')) {
      seniorities.add('Senior Leadership');
    } else if (profile.summary.includes('Manager') || profile.summary.includes('Lead')) {
      seniorities.add('Management');
    }
  });
  
  let suggestions = '**MEETING APPROACH SUGGESTIONS**\n';
  
  if (industries.size > 0) {
    suggestions += `• Industry Focus: ${Array.from(industries).join(', ')}\n`;
  }
  
  if (seniorities.size > 0) {
    suggestions += `• Audience Level: ${Array.from(seniorities).join(', ')}\n`;
  }
  
  suggestions += `• Recommended prep: Review attendee contexts above for personalized talking points\n`;
  
  return suggestions;
}

// Helper function to run standalone research (for testing)
export async function runStandaloneResearch(email: string): Promise<PersonProfile> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  const researcher = new ProfessionalResearcher(apiKey);
  return await researcher.researchPerson(email);
}