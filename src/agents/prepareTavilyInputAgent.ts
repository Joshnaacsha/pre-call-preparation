import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import type { GraphState, RetrievedMeeting } from '../graph/graphState.js';


dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function prepareTavilyInputAgent(state: GraphState): Promise<GraphState> {
  const recentEvent = state.calendarEvents[0];
  const previousMeetings: RetrievedMeeting[] = state.previousMeetingsByProject?.[recentEvent.summary] || [];

  const prompt = `
You are an AI assistant helping a sales team prepare for external research.
Based on the project summary and past meeting notes, create a short external search query (for tools like Tavily).

Return ONLY this format:

{
  "searchQuery": string
}

Project Summary: ${recentEvent.summary}

Description:
${recentEvent.description}

Previous Meeting Notes:
${previousMeetings.map((m) => m.pageContent).join('\n\n')}
`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const raw = await result.response.text();

  try {
    const parsed = JSON.parse(raw.trim().replace(/^```json/, '').replace(/```$/, ''));

   state.externalResearch = {
  companyNews: parsed.searchQuery,
  contactUpdates: '',
  searchQuery: parsed.searchQuery, // ✅ add this line
};

    console.log('🔎 Tavily Search Query Prepared:', parsed.searchQuery);
    return state;
  } catch (err) {
    console.error('❌ Failed to parse Tavily search prompt output:', raw);
  state.externalResearch = {
  companyNews: '',
  contactUpdates: '',
  searchQuery: '',
};

    return state;
  }
}
