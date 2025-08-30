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
  hunterData?: HunterPersonData;
  companyData?: HunterCompanyData;
}

interface HunterPersonData {
  first_name?: string;
  last_name?: string;
  email: string;
  position?: string;
  twitter?: string;
  linkedin_url?: string;
  phone_number?: string;
  confidence?: number;
}

interface HunterCompanyData {
  domain: string;
  organization?: string;
  country?: string;
  industry?: string;
  description?: string;
  website?: string;
  logo?: string;
  facebook?: string;
  twitter?: string;
  linkedin?: string;
  instagram?: string;
  youtube?: string;
  technologies?: string[];
  size?: string;
  revenue?: string;
}

interface HunterEmailVerification {
  result: 'deliverable' | 'undeliverable' | 'risky' | 'unknown';
  score: number;
  email: string;
  regexp: boolean;
  gibberish: boolean;
  disposable: boolean;
  webmail: boolean;
  mx_records: boolean;
  smtp_server: boolean;
  smtp_check: boolean;
  accept_all: boolean;
}

class HunterProfessionalResearcher {
  private client: OpenAI;
  private hunterApiKey: string;
  private hunterBaseUrl = 'https://api.hunter.io/v2';
  private model = "gpt-4o";

  constructor(openaiApiKey: string, hunterApiKey: string) {
    this.client = new OpenAI({ apiKey: openaiApiKey });
    this.hunterApiKey = hunterApiKey;
  }

  async researchPerson(email: string): Promise<PersonProfile> {
    try {
      const domain = email.split('@')[1];
      
      console.log(`   🔍 Researching: ${email} via Hunter.io + AI`);

      // Step 1: Get person data from Hunter.io
      const hunterPersonData = await this.getPersonFromHunter(email);
      
      // Step 2: Get company data from Hunter.io
      const hunterCompanyData = await this.getCompanyFromHunter(domain);
      
      // Step 3: Verify email if we have person data
      const emailVerification = hunterPersonData ? await this.verifyEmailWithHunter(email) : null;
      
      // Step 4: Use AI to synthesize professional summary
      const aiSummary = await this.generateAISummary(email, hunterPersonData, hunterCompanyData, emailVerification);
      
      const isVerified = this.determineVerificationStatus(hunterPersonData, hunterCompanyData, emailVerification);

      return {
        email,
        domain,
        summary: aiSummary,
        timestamp: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        verified: isVerified,
        sourceCount: this.calculateSourceCount(hunterPersonData, hunterCompanyData),
        hunterData: hunterPersonData || undefined,
        companyData: hunterCompanyData || undefined,
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

  private async getPersonFromHunter(email: string): Promise<HunterPersonData | null> {
    try {
      const response = await fetch(
        `${this.hunterBaseUrl}/people/find?email=${encodeURIComponent(email)}&api_key=${this.hunterApiKey}`
      );
      
      if (!response.ok) {
        if (response.status === 404) {
          console.log(`   ℹ️ No data found in Hunter.io for ${email} (email exists but not in database)`);
        } else if (response.status === 400) {
          console.log(`   ⚠️ Invalid email format or non-business domain: ${email}`);
        } else {
          console.log(`   ⚠️ Hunter person lookup failed for ${email}: ${response.status}`);
        }
        return null;
      }
      
      const data = await response.json();
      return data.data || null;
    } catch (error) {
      console.error(`   ❌ Hunter person API error for ${email}:`, error);
      return null;
    }
  }

  private async getCompanyFromHunter(domain: string): Promise<HunterCompanyData | null> {
    try {
      const response = await fetch(
        `${this.hunterBaseUrl}/companies/find?domain=${encodeURIComponent(domain)}&api_key=${this.hunterApiKey}`
      );
      
      if (!response.ok) {
        console.log(`   ⚠️ Hunter company lookup failed for ${domain}: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      return data.data || null;
    } catch (error) {
      console.error(`   ❌ Hunter company API error for ${domain}:`, error);
      return null;
    }
  }

  private async verifyEmailWithHunter(email: string): Promise<HunterEmailVerification | null> {
    try {
      const response = await fetch(
        `${this.hunterBaseUrl}/email-verifier?email=${encodeURIComponent(email)}&api_key=${this.hunterApiKey}`
      );
      
      if (!response.ok) {
        console.log(`   ⚠️ Hunter email verification failed for ${email}: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      return data.data || null;
    } catch (error) {
      console.error(`   ❌ Hunter verification API error for ${email}:`, error);
      return null;
    }
  }

  private async generateAISummary(
    email: string, 
    personData: HunterPersonData | null, 
    companyData: HunterCompanyData | null,
    verification: HunterEmailVerification | null
  ): Promise<string> {
    const prompt = this.buildEnhancedResearchPrompt(email, personData, companyData, verification);

    const chatResponse = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: "You are a professional researcher that synthesizes verified data from Hunter.io with additional professional insights to provide actionable meeting preparation intelligence."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 1200,
    });

    return chatResponse.choices[0]?.message?.content || "AI summary generation failed.";
  }

  private buildEnhancedResearchPrompt(
    email: string, 
    personData: HunterPersonData | null, 
    companyData: HunterCompanyData | null,
    verification: HunterEmailVerification | null
  ): string {
    let hunterDataSection = "";
    
    if (personData) {
      hunterDataSection += `\n**HUNTER.IO PERSON DATA:**\n`;
      hunterDataSection += `• Name: ${personData.first_name || 'Unknown'} ${personData.last_name || ''}\n`;
      hunterDataSection += `• Position: ${personData.position || 'Not specified'}\n`;
      hunterDataSection += `• Confidence Score: ${personData.confidence || 'N/A'}%\n`;
      if (personData.linkedin_url) hunterDataSection += `• LinkedIn: Available\n`;
      if (personData.twitter) hunterDataSection += `• Twitter: @${personData.twitter}\n`;
    }
    
    if (companyData) {
      hunterDataSection += `\n**HUNTER.IO COMPANY DATA:**\n`;
      hunterDataSection += `• Organization: ${companyData.organization || 'Not found'}\n`;
      hunterDataSection += `• Industry: ${companyData.industry || 'Not specified'}\n`;
      hunterDataSection += `• Description: ${companyData.description || 'Not available'}\n`;
      hunterDataSection += `• Size: ${companyData.size || 'Unknown'}\n`;
      hunterDataSection += `• Country: ${companyData.country || 'Not specified'}\n`;
      if (companyData.technologies) {
        hunterDataSection += `• Technologies: ${companyData.technologies.slice(0, 5).join(', ')}\n`;
      }
    }

    if (verification) {
      hunterDataSection += `\n**EMAIL VERIFICATION:**\n`;
      hunterDataSection += `• Status: ${verification.result} (Score: ${verification.score}%)\n`;
      hunterDataSection += `• Valid Format: ${verification.regexp ? 'Yes' : 'No'}\n`;
      hunterDataSection += `• Corporate Email: ${verification.webmail ? 'No' : 'Yes'}\n`;
    }

    return `
Research and synthesize professional intelligence for: ${email}

${hunterDataSection}

INSTRUCTIONS:
1. Use the Hunter.io data above as your PRIMARY source of verified information
2. If Hunter.io data is incomplete, indicate what additional research might be helpful
3. Focus on actionable intelligence for business meeting preparation
4. Keep response concise but comprehensive (max 600 words)
5. If no Hunter.io data found, clearly state "Limited verified data available"

RESPONSE FORMAT:

**PROFESSIONAL PROFILE SUMMARY**
• Full Name: [from Hunter.io or indicate if unknown]
• Current Role: [position from Hunter.io]
• Company: [organization from Hunter.io + industry context]
• Verification Status: [based on Hunter.io confidence + email verification]

**COMPANY CONTEXT**
• Industry & Focus: [from Hunter.io company data]
• Company Size/Scale: [if available from Hunter.io]
• Technology Stack: [from Hunter.io tech data if available]
• Business Context: [synthesize company description into meeting relevance]

**MEETING PREPARATION INTELLIGENCE**
• Likely Role in Decision Making: [analyze based on position]
• Key Discussion Topics: [based on industry and role]
* Potential Pain Points: [industry-specific challenges]
• Communication Style Suggestions: [based on role level and company type]

**DATA CONFIDENCE LEVEL**
• Hunter.io Confidence: [percentage if available]
• Email Deliverability: [verification status]
• Information Completeness: [assessment of data quality]

If Hunter.io found no data, respond with:
"**LIMITED DATA AVAILABLE**
Hunter.io could not locate verified professional information for: ${email}
Company domain analysis: [basic domain analysis]
Recommendation: Prepare general talking points for the meeting."

Focus on actionable insights that will help in business meeting preparation.
`;
  }

  private determineVerificationStatus(
    personData: HunterPersonData | null, 
    companyData: HunterCompanyData | null,
    verification: HunterEmailVerification | null
  ): boolean {
    // Consider verified if we have person data with good confidence OR company data
    if (personData && personData.confidence && personData.confidence > 70) return true;
    if (companyData && companyData.organization) return true;
    if (verification && verification.result === 'deliverable') return true;
    return false;
  }

  private calculateSourceCount(personData: HunterPersonData | null, companyData: HunterCompanyData | null): number {
    let count = 0;
    if (personData) count++;
    if (companyData) count++;
    return Math.max(count, 1);
  }

  // Additional Hunter.io methods for enhanced functionality

  async getDomainEmails(domain: string, limit: number = 10): Promise<string[]> {
    try {
      const response = await fetch(
        `${this.hunterBaseUrl}/domain-search?domain=${encodeURIComponent(domain)}&limit=${limit}&api_key=${this.hunterApiKey}`
      );
      
      if (!response.ok) return [];
      
      const data = await response.json();
      return data.data?.emails?.map((e: any) => e.value) || [];
    } catch (error) {
      console.error(`Hunter domain search error for ${domain}:`, error);
      return [];
    }
  }

  async findEmailByName(domain: string, firstName: string, lastName: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.hunterBaseUrl}/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${this.hunterApiKey}`
      );
      
      if (!response.ok) return null;
      
      const data = await response.json();
      return data.data?.email || null;
    } catch (error) {
      console.error(`Hunter email finder error:`, error);
      return null;
    }
  }
}

export async function conductHunterResearch(state: GraphState): Promise<GraphState> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const hunterApiKey = process.env.HUNTER_API_KEY;
  
  if (!openaiApiKey || openaiApiKey.startsWith("your_api_key")) {
    console.warn('⚠️ OPENAI_API_KEY not configured - skipping research');
    return {
      ...state,
      externalResearch: {
        contactUpdates: 'Research skipped - OpenAI API key not configured',
        searchQuery: 'Research skipped - API key not configured',
      }
    };
  }

  if (!hunterApiKey || hunterApiKey.startsWith("your_hunter_api_key")) {
    console.warn('⚠️ HUNTER_API_KEY not configured - falling back to AI-only research');
    return conductLinkedInResearch(state); // Fallback to your existing method
  }

  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.warn('⚠️ No calendar events found for research');
    return state;
  }

  const currentEvent = state.calendarEvents[0];
  const researcher = new HunterProfessionalResearcher(openaiApiKey, hunterApiKey);
  
  console.log('🎯 Starting Hunter.io + AI professional research...');
  console.log(`   📧 Meeting attendees: ${currentEvent.attendees.length}`);

  // Filter attendees - skip internal emails
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
        searchQuery: `Hunter.io research: ${currentEvent.summary}`,
      }
    };
  }

  const profiles: PersonProfile[] = [];
  
  // Research each external attendee
  for (const email of externalAttendees.slice(0, 10)) { // Hunter.io can handle more requests
    try {
      const profile = await researcher.researchPerson(email);
      profiles.push(profile);
      
      if (profile.verified) {
        console.log(`   ✅ Research completed: ${email} (Hunter.io + AI)`);
      } else {
        console.log(`   ⚠️ Limited info found: ${email}`);
      }
      
      // Smaller delay since Hunter.io has higher rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`   ❌ Failed to research ${email}:`, error);
    }
  }

  // Generate consolidated research summary
  const researchSummary = generateEnhancedResearchSummary(profiles, currentEvent);
  
  console.log(`✅ Hunter.io research completed: ${profiles.length} profiles researched`);
  console.log(`   📊 Verified profiles: ${profiles.filter(p => p.verified).length}`);
  console.log(`   🎯 Hunter.io data found: ${profiles.filter(p => p.hunterData).length}`);

  return {
    ...state,
    externalResearch: {
      contactUpdates: researchSummary,
      searchQuery: state.externalResearch?.searchQuery || `Hunter.io research: ${currentEvent.summary}`,
    }
  };
}

// Keep your original function as fallback
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

// Original ProfessionalResearcher class for fallback
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

function generateEnhancedResearchSummary(profiles: PersonProfile[], event: CalendarEvent): string {
  const verifiedProfiles = profiles.filter(p => p.verified);
  const hunterProfiles = profiles.filter(p => p.hunterData || p.companyData);
  const unverifiedCount = profiles.length - verifiedProfiles.length;

  if (verifiedProfiles.length === 0) {
    return `Hunter.io + AI research conducted for ${profiles.length} attendee(s) - limited verified data available. Meeting: ${event.summary}`;
  }

  let summary = `**MEETING INTELLIGENCE** (${verifiedProfiles.length}/${profiles.length} profiles verified)\n`;
  summary += `*Powered by Hunter.io + AI Analysis*\n\n`;

  verifiedProfiles.forEach((profile, index) => {
    const domain = profile.domain;
    const hunterPerson = profile.hunterData;
    const hunterCompany = profile.companyData;
    
    summary += `**${index + 1}. ${hunterPerson?.first_name || 'Contact'} ${hunterPerson?.last_name || ''} (${profile.email})**\n`;
    
    if (hunterPerson?.position) {
      summary += `• Role: ${hunterPerson.position}\n`;
    }
    
    if (hunterCompany?.organization) {
      summary += `• Company: ${hunterCompany.organization}`;
      if (hunterCompany.industry) summary += ` (${hunterCompany.industry})`;
      summary += '\n';
    } else {
      summary += `• Domain: ${domain}\n`;
    }
    
    if (hunterCompany?.size) {
      summary += `• Company Size: ${hunterCompany.size}\n`;
    }
    
    if (hunterCompany?.technologies && hunterCompany.technologies.length > 0) {
      summary += `• Tech Stack: ${hunterCompany.technologies.slice(0, 3).join(', ')}\n`;
    }
    
    if (hunterPerson?.confidence) {
      summary += `• Data Confidence: ${hunterPerson.confidence}%\n`;
    }
    
    // Extract key insights from AI summary
    const keyInsights = extractKeyInsightsFromSummary(profile.summary);
    if (keyInsights.length > 0) {
      summary += `• Meeting Context: ${keyInsights.slice(0, 2).join(' • ')}\n`;
    }
    
    summary += '\n';
  });

  if (unverifiedCount > 0) {
    summary += `*Note: ${unverifiedCount} additional attendee(s) researched with limited verified data.*\n\n`;
  }

  // Add enhanced meeting context suggestions
  summary += generateHunterMeetingContextSuggestions(verifiedProfiles);
  summary += generateTechStackInsights(verifiedProfiles);

  summary += `\n*Research completed: ${dayjs().format("MMM DD, YYYY HH:mm")} | Sources: Hunter.io Professional Database + AI Analysis*`;

  return summary;
}

function generateHunterMeetingContextSuggestions(profiles: PersonProfile[]): string {
  const industries = new Set<string>();
  const companies = new Set<string>();
  const techStacks = new Set<string>();
  const seniorities = new Set<string>();
  
  profiles.forEach(profile => {
    if (profile.companyData?.industry) {
      industries.add(profile.companyData.industry);
    }
    
    if (profile.companyData?.organization) {
      companies.add(profile.companyData.organization);
    }
    
    if (profile.companyData?.technologies) {
      profile.companyData.technologies.slice(0, 5).forEach(tech => techStacks.add(tech));
    }
    
    const position = profile.hunterData?.position?.toLowerCase() || '';
    if (position.includes('director') || position.includes('vp') || position.includes('chief')) {
      seniorities.add('C-Suite/Director Level');
    } else if (position.includes('manager') || position.includes('lead')) {
      seniorities.add('Management');
    } else if (position.includes('senior')) {
      seniorities.add('Senior Individual Contributor');
    }
  });
  
  let suggestions = '**STRATEGIC MEETING APPROACH**\n';
  
  if (companies.size > 0) {
    suggestions += `• Organizations Represented: ${Array.from(companies).slice(0, 3).join(', ')}\n`;
  }
  
  if (industries.size > 0) {
    suggestions += `• Industry Focus: ${Array.from(industries).join(', ')}\n`;
  }
  
  if (seniorities.size > 0) {
    suggestions += `• Audience Level: ${Array.from(seniorities).join(', ')}\n`;
  }
  
  suggestions += `• Verified Contacts: ${profiles.filter(p => p.hunterData?.confidence && p.hunterData.confidence > 80).length} high-confidence\n`;
  
  return suggestions;
}

function generateTechStackInsights(profiles: PersonProfile[]): string {
  const techStacks = new Set<string>();
  
  profiles.forEach(profile => {
    if (profile.companyData?.technologies) {
      profile.companyData.technologies.forEach(tech => techStacks.add(tech));
    }
  });
  
  if (techStacks.size === 0) return '';
  
  const topTech = Array.from(techStacks).slice(0, 8);
  return `\n**TECHNOLOGY LANDSCAPE**\n• Common Tech Stack: ${topTech.join(', ')}\n`;
}

function extractKeyInsightsFromSummary(summary: string): string[] {
  const insights: string[] = [];
  
  // Extract decision making indicators
  if (summary.includes('decision') || summary.includes('authority') || summary.includes('budget')) {
    insights.push('Decision maker');
  }
  
  // Extract expertise areas
  const expertiseMatch = summary.match(/expertise[^.]*([^.]{0,50})/i);
  if (expertiseMatch) {
    insights.push(`Expertise: ${expertiseMatch[1].trim()}`);
  }
  
  // Extract pain points
  if (summary.includes('challenge') || summary.includes('pain point')) {
    insights.push('Has specific business challenges');
  }
  
  return insights.slice(0, 2);
}

// Keep original functions for backward compatibility
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

// Helper function to run standalone Hunter.io research (for testing)
export async function runStandaloneHunterResearch(email: string): Promise<PersonProfile> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const hunterApiKey = process.env.HUNTER_API_KEY;
  
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  if (!hunterApiKey) {
    console.warn('HUNTER_API_KEY not configured - falling back to AI-only research');
    const researcher = new ProfessionalResearcher(openaiApiKey);
    return await researcher.researchPerson(email);
  }
  
  const researcher = new HunterProfessionalResearcher(openaiApiKey, hunterApiKey);
  return await researcher.researchPerson(email);
}

// Helper function to run original research (for testing)
export async function runStandaloneResearch(email: string): Promise<PersonProfile> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  const researcher = new ProfessionalResearcher(apiKey);
  return await researcher.researchPerson(email);
}

// Export both methods for flexibility
export { HunterProfessionalResearcher, ProfessionalResearcher };