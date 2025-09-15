import axios from 'axios';
import { OpenAIEmbeddings } from '@langchain/openai';

interface GraphEvent {
  id: string;
  subject: string;
  bodyPreview: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: Array<{ emailAddress: { address: string; name: string } }>;
  location: { displayName: string };
  body: { content: string };
}

interface ConvertedResult {
  metadata: {
    summary: string;
    startTime: string;
    client_name: string;
    project_name: string;
  };
  pageContent: string;
}

const embeddings = new OpenAIEmbeddings();

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Search previous meetings using Microsoft Graph events, excluding the current one by startTime
 * @param {string} projectName - Project name or client name to search with
 * @param {string} currentStartTime - ISO start time of the current meeting
 * @param {string} accessToken - Microsoft Graph access token
 * @returns {Promise<Array>} - Top 3 similar meetings excluding the current
 */
export const searchPreviousMeetings = async (
  projectName: string,
  currentStartTime: string,
  accessToken: string
) => {
  // Fetch previous events from Microsoft Graph (before currentStartTime)
  let events: GraphEvent[] = [];
  try {
    const response = await axios.get<{ value: GraphEvent[] }>('https://graph.microsoft.com/v1.0/me/events', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      params: {
        $orderby: 'start/dateTime desc',
        $top: 50,
        $filter: `start/dateTime lt '${currentStartTime}'`
      }
    });
    events = response.data.value || [];
  } catch (error) {
    console.error('Error fetching events from Microsoft Graph:', error);
    return [];
  }

  // Use LLM embeddings to compare project/client name for fuzzy matching
  const currentMeetingString = `Client: ${projectName}`;
  const currentEmbedding = await embeddings.embedQuery(currentMeetingString);

  // Calculate semantic similarity for each previous event
  const scoredResults = await Promise.all(
    (events || []).map(async (event) => {
      // Try to extract client/project name from subject or body
      const subject = event.subject || '';
      const body = event.bodyPreview || '';
      const prevMeetingString = `Client: ${subject}, Body: ${body}`;
      const prevEmbedding = await embeddings.embedQuery(prevMeetingString);
      const similarity = cosineSimilarity(currentEmbedding, prevEmbedding);
      return {
        ...event,
        semanticScore: similarity
      };
    })
  );

  // Lower semantic threshold for candidate pool
  const candidateResults = scoredResults
    .filter(result => result.semanticScore > 0.80)
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, 20);

  // Use LLM to check if company names refer to the same company
  const { OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  async function isSameCompany(nameA: string, nameB: string): Promise<boolean> {
    if (!nameA || !nameB) return false;
    if (nameA.trim().toLowerCase() === nameB.trim().toLowerCase()) return true;
    const prompt = `Are the following two company names referring to the same company?\n\nName 1: ${nameA}\nName 2: ${nameB}\n\nAnswer only 'yes' or 'no'.`;
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 3
      });
      const answer = resp.choices[0]?.message?.content?.toLowerCase() || '';
      return answer.includes('yes');
    } catch (err) {
      console.error('LLM company match error:', err);
      return false;
    }
  }

  // Filter candidates using LLM for company name match
  const fuzzyRelevantResults = [];
  for (const result of candidateResults) {
    // Try to extract company/client name from subject
    const prevName = result.subject || '';
    const isMatch = await isSameCompany(projectName, prevName);
    if (isMatch) fuzzyRelevantResults.push(result);
  }

  if (fuzzyRelevantResults.length === 0) {
    console.log(`No previous meetings found for client (LLM match): ${projectName}`);
    return [];
  }

  console.log(`🔍 Found ${fuzzyRelevantResults.length} LLM-matched meetings for client: ${projectName}`);
  // Convert relevant results to the expected format, with safe date handling
  const converted = fuzzyRelevantResults.map((event: GraphEvent): ConvertedResult => {
    let startTime = '';
    try {
      startTime = event.start?.dateTime
        ? new Date(event.start.dateTime).toISOString()
        : new Date().toISOString();
    } catch (error) {
      startTime = new Date().toISOString();
    }
    return {
      metadata: {
        summary: event.subject || '',
        startTime,
        client_name: event.subject || '',
        project_name: event.subject || ''
      },
      pageContent: event.body?.content || event.bodyPreview || ''
    };
  });

  // Deduplicate using a combination of summary + startTime
  const seen = new Set<string>();
  const filtered = converted.filter((result: ConvertedResult) => {
    const key = `${result.metadata.startTime}-${result.metadata.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return filtered.slice(0, 3);
};
