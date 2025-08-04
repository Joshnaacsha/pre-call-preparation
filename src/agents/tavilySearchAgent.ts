import { TavilyClient } from 'tavily';
import type { GraphState } from '../graph/graphState.js';

const tavily = new TavilyClient({
  apiKey: process.env.TAVILY_API_KEY!,
});
export async function prepareTavilyInputAgent(state: GraphState): Promise<GraphState> {
  const event = state.calendarEvents?.[0];

  if (!event) {
    console.warn("⚠️ No event found in calendarEvents.");
    return state;
  }

  const summary = event.summary;
  const description = event.description;

  const projectName = summary.split('-')[0].trim();
  const query = `${projectName} cloud migration risks rollback strategy`;

  return {
    ...state,
    externalResearch: {
      searchQuery: query,
    },
  };
}
