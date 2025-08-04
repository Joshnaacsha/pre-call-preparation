import { authorizeAndListEvents } from './calendar/authorize.js';
import { embedAndStoreAllEvents } from './embeddings/embedAndStore.js';
import { searchPreviousMeetings } from './calendar/searchPreviousMeetings.js';
import { prepareTavilyInputAgent } from './agents/tavilySearchAgent.js';
import { generateMeetingSummary } from './agents/summaryGenarationAgent.js';
import type { GraphState, RetrievedMeeting } from './graph/graphState.js';
import fs from 'fs';
import path from 'path';

async function main() {
  let state: GraphState = await authorizeAndListEvents();
  
  // 🔍 DEBUG: Check what we got from authorize
  console.log('🔍 Debug - State after authorize:', {
    hasCalendarEvents: !!state.calendarEvents,
    eventsLength: state.calendarEvents?.length || 0,
    stateKeys: Object.keys(state),
    firstEvent: state.calendarEvents?.[0]?.summary || 'No first event'
  });
  
  console.log('📅 Events fetched and stored in state.');

  // 🔍 DEBUG: Check if calendarEvents exists before embedding
  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.error('❌ No calendar events found after authorization!');
    return;
  }

  await embedAndStoreAllEvents(state);
  console.log('✅ All events embedded and stored in Supabase.');

  const previousMeetingsByProject: Record<string, RetrievedMeeting[]> = {};

  // 🔍 DEBUG: Check calendarEvents before the loop
  console.log('🔍 Debug - About to iterate over events:', state.calendarEvents?.length || 0);

  for (const event of state.calendarEvents) {
    if (!event || !event.summary) {
      console.warn('⚠️ Skipping invalid event:', event);
      continue;
    }

    const projectName = event.summary;
    const results = await searchPreviousMeetings(projectName, event.startTime);

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

  // 🔍 DEBUG: Check state before calling prepareTavilyInputAgent
  console.log('🔍 Debug - State before prepareTavilyInputAgent:', {
    hasCalendarEvents: !!state.calendarEvents,
    eventsLength: state.calendarEvents?.length || 0,
    hasPreviousMeetings: !!state.previousMeetingsByProject,
    stateKeys: Object.keys(state)
  });

  // ✅ EXTERNAL RESEARCH
  try {
    state = await prepareTavilyInputAgent(state);
    console.log('🌐 External research completed and stored in state.');
    
    // 🔍 DEBUG: Show external research results
    console.log('🎯 External Research Results:');
    console.log('🔍 Search Query:', state.externalResearch?.searchQuery || 'None');
    console.log('🏢 Company News:', state.externalResearch?.companyNews?.slice(0, 200) + '...' || 'None');
    console.log('👥 Contact Updates:', state.externalResearch?.contactUpdates || 'None');
  } catch (error) {
    console.error('❌ Error in prepareTavilyInputAgent:', error);
  }

  // ✅ GENERATE COMPREHENSIVE SUMMARY
  try {
    console.log('\n🎯 Starting comprehensive summary generation...');
    state = await generateMeetingSummary(state);
    console.log('📋 Meeting summary generated successfully!');
    
    // Save the summary to a file for easy access
    const summaryFileName = `meeting-summary-${new Date().toISOString().split('T')[0]}.md`;
    const summaryPath = path.join(process.cwd(), 'summaries', summaryFileName);
    
    // Create summaries directory if it doesn't exist
    const summariesDir = path.join(process.cwd(), 'summaries');
    if (!fs.existsSync(summariesDir)) {
      fs.mkdirSync(summariesDir, { recursive: true });
    }
    
    // Write summary to file
    fs.writeFileSync(summaryPath, state.summary || 'No summary generated');
    console.log(`💾 Summary saved to: ${summaryPath}`);
    
    // Display key highlights
    console.log('\n🌟 SUMMARY HIGHLIGHTS:');
    console.log('📊 Meeting:', state.calendarEvents[0].summary);
    console.log('📅 Date:', new Date(state.calendarEvents[0].startTime).toLocaleDateString());
    console.log('📍 Location:', state.calendarEvents[0].location || 'Not specified');
    console.log('📄 Full briefing document saved to summaries folder');
    
  } catch (error) {
    console.error('❌ Error generating meeting summary:', error);
  }

  console.log('\n🎉 Pre-call preparation pipeline completed successfully!');
  console.log('📋 Check the summaries folder for your detailed briefing document.');
}

main().catch((err) => {
  console.error('❌ Error in pipeline:', err);
});