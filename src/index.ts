import { authorizeAndListEvents } from './calendar/authorize.js';
import { embedAndStoreAllEvents } from './embeddings/embedAndStore.js';
import { searchPreviousMeetings } from './calendar/searchPreviousMeetings.js';
import type { GraphState, RetrievedMeeting } from './graph/graphState.js';

async function main() {
  const state: GraphState = await authorizeAndListEvents();
  console.log('📅 Events fetched and stored in state.');

  await embedAndStoreAllEvents(state);
  console.log('✅ All events embedded and stored in Supabase.');

  const previousMeetingsByProject: Record<string, RetrievedMeeting[]> = {};

  for (const event of state.calendarEvents) {
    const projectName = event.summary;

const results = await searchPreviousMeetings(projectName, event.startTime);

    // Convert documents to RetrievedMeeting[]
    const converted: RetrievedMeeting[] = results.map((doc) => {
      const { metadata, pageContent } = doc;
      return {
        metadata: {
          summary: metadata.summary ?? '',
          startTime: metadata.startTime ?? '',
        },
        pageContent,
      };
    });

    previousMeetingsByProject[projectName] = converted;

    // 🔍 Log each result
    console.log(`📂 Previous meetings for "${projectName}":`);
    for (const meeting of converted) {
      console.log({
        summary: meeting.metadata.summary,
        startTime: meeting.metadata.startTime,
        snippet: meeting.pageContent.slice(0, 200) + '...',
      });
    }
  }

  state.previousMeetingsByProject = previousMeetingsByProject;

  console.log('📚 Retrieved related meetings and updated state.');

  // await agent.prepareTavilyInput(state);
}

main().catch((err) => {
  console.error('❌ Error in pipeline:', err);
});
