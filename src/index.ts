import { authorizeAndListEvents } from './calendar/authorize.js';
import { embedAndStoreAllEvents } from './embeddings/embedAndStore.js';
import { searchPreviousMeetings } from './calendar/searchPreviousMeetings.js';
import { prepareTavilyInputAgent } from './agents/tavilySearchAgent.js';
import { conductLinkedInResearch } from './agents/linkedinAgent.js';
import { generateMeetingSummary } from './agents/summaryGenarationAgent.js';
import { generatePdfAndSendEmail } from './agents/pdfEmailAgent.js';
import { hasPdfBeenGenerated, markPdfAsGenerated } from './calendar/listEvents.js';
import type { GraphState, RetrievedMeeting } from './graph/graphState.js';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('\n🚀 Starting Cprime AI Pre-Call Pipeline...');
  console.log('=' .repeat(60));
  console.log('🕐 Scanning for client meetings in the next 3 hours...\n');

  // Step 1: Get filtered calendar events (only next 3 hours, client meetings)
  let state: GraphState = await authorizeAndListEvents();
  
  // 🔍 DEBUG: Check what we got from authorize
  console.log('🔍 Debug - State after authorize:', {
    hasCalendarEvents: !!state.calendarEvents,
    eventsLength: state.calendarEvents?.length || 0,
    stateKeys: Object.keys(state),
    firstEvent: state.calendarEvents?.[0]?.summary || 'No events found'
  });

  // Check if any client meetings found in next 3 hours
  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.log('✅ No client meetings found in the next 3 hours.');
    console.log('   - All existing meetings may already have PDFs generated');
    console.log('   - Or no meetings match client/external attendee criteria');
    console.log('   - Pipeline completed successfully with no work needed.\n');
    return;
  }

  console.log(`📅 Found ${state.calendarEvents.length} client meeting(s) requiring processing:`);
  state.calendarEvents.forEach((event, index) => {
    const timeUntil = getTimeUntilMeeting(event.startTime);
    const urgencyFlag = getUrgencyFlag(event.startTime);
    console.log(`   ${index + 1}. ${urgencyFlag}${event.summary} - ${timeUntil}`);
  });
  console.log('');

  // Step 2: Embed and store all events (now includes automatic duplicate checking)
  await embedAndStoreAllEvents(state);
  console.log('');

  // Step 3: Process each meeting individually
  console.log('🔄 Processing meetings individually...');
  console.log('-' .repeat(40));

  for (let i = 0; i < state.calendarEvents.length; i++) {
    const currentEvent = state.calendarEvents[i];
    const eventId = (state as any).clientEventIds?.[i];
    
    console.log(`\n📋 Processing Meeting ${i + 1}/${state.calendarEvents.length}:`);
    console.log(`   Title: ${currentEvent.summary}`);
    console.log(`   Time: ${new Date(currentEvent.startTime).toLocaleString()}`);
    console.log(`   Attendees: ${currentEvent.attendees.join(', ')}`);

    // Check if PDF already exists for this meeting
    if (hasPdfBeenGenerated(currentEvent, eventId)) {
      console.log(`   ⏭️  PDF already exists - skipping this meeting`);
      continue;
    }

    try {
      // Create individual state for this meeting
      const individualMeetingState: GraphState = {
        calendarEvents: [currentEvent],
        clientEventIds: eventId ? [eventId] : undefined,
        externalResearch: {
          searchQuery: '',
          companyNews: '',
          contactUpdates: '',
        },
      };

      // Step 3a: Search for previous meetings for this specific event
      console.log(`   🔍 Searching previous meetings for "${currentEvent.summary}"...`);
      const results = await searchPreviousMeetings(currentEvent.summary, currentEvent.startTime);
      
      const convertedMeetings: RetrievedMeeting[] = results.map((doc) => {
        const { metadata, pageContent } = doc;
        return {
          metadata: {
            summary: metadata.summary ?? '',
            startTime: metadata.startTime ?? '',
          },
          pageContent,
        };
      });

      individualMeetingState.previousMeetingsByProject = {
        [currentEvent.summary]: convertedMeetings
      };

      console.log(`   📚 Found ${convertedMeetings.length} related previous meetings`);
      
      // Step 3b: External research for this meeting (Tavily search)
      console.log(`   🌐 Conducting external company research...`);
      try {
        const researchedState = await prepareTavilyInputAgent(individualMeetingState);
        individualMeetingState.externalResearch = researchedState.externalResearch;
        console.log(`   ✅ External company research completed`);
        
        // Show brief research summary
        if (researchedState.externalResearch?.searchQuery) {
          console.log(`      🔍 Search: ${researchedState.externalResearch.searchQuery}`);
          const newsLength = researchedState.externalResearch.companyNews?.length || 0;
          console.log(`      📊 Company Data: ${newsLength} characters`);
        }
      } catch (error) {
        console.error(`   ⚠️  External company research failed: ${error}`);
        // Continue without external research
      }

     // Step 3c: LinkedIn/Professional Research for attendees
      console.log(`   🔗 Conducting attendee profile research...`);
      try {
        const linkedinState = await conductLinkedInResearch(individualMeetingState);
        // Merge the contactUpdates from LinkedIn research with existing externalResearch
        // Ensure all required fields are present
        individualMeetingState.externalResearch = {
          searchQuery: linkedinState.externalResearch?.searchQuery || individualMeetingState.externalResearch?.searchQuery || '',
          companyNews: linkedinState.externalResearch?.companyNews || individualMeetingState.externalResearch?.companyNews || '',
          contactUpdates: linkedinState.externalResearch?.contactUpdates || individualMeetingState.externalResearch?.contactUpdates || '',
        };
        console.log(`   ✅ Attendee profile research completed`);
        
        // Show brief LinkedIn research summary
        const contactLength = linkedinState.externalResearch?.contactUpdates?.length || 0;
        console.log(`      👥 Attendee Data: ${contactLength} characters`);
      } catch (error) {
        console.error(`   ⚠️  LinkedIn research failed: ${error}`);
        // Continue without LinkedIn research
      }
      
      // Step 3d: Generate meeting summary (now includes all research data)
      console.log(`   🤖 Generating AI meeting summary...`);
      try {
        const summaryState = await generateMeetingSummary(individualMeetingState);
        individualMeetingState.summary = summaryState.summary;
        console.log(`   ✅ Summary generated (${summaryState.summary?.length || 0} characters)`);
        
        // Show data sources used in summary
        const hasCompanyNews = (individualMeetingState.externalResearch?.companyNews?.length || 0) > 50;
        const hasAttendeeData = individualMeetingState.externalResearch?.contactUpdates && 
          !individualMeetingState.externalResearch.contactUpdates.includes('skipped');
        const hasPreviousMeetings = convertedMeetings.length > 0;
        
        console.log(`      📊 Data sources: Company news: ${hasCompanyNews ? 'Yes' : 'No'}, Attendee profiles: ${hasAttendeeData ? 'Yes' : 'No'}, Previous meetings: ${hasPreviousMeetings ? 'Yes' : 'No'}`);
        
      } catch (error) {
        console.error(`   ❌ Summary generation failed:`, error);
        continue; // Skip to next meeting if summary fails
      }

      // Step 3e: Save individual summary to file
      const summaryFileName = `briefing-${currentEvent.summary.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.md`;
      const summaryPath = path.join(process.cwd(), 'summaries', summaryFileName);
      
      // Create summaries directory if it doesn't exist
      const summariesDir = path.join(process.cwd(), 'summaries');
      if (!fs.existsSync(summariesDir)) {
        fs.mkdirSync(summariesDir, { recursive: true });
      }
      
      // Write summary to file
      if (individualMeetingState.summary) {
        fs.writeFileSync(summaryPath, individualMeetingState.summary);
        console.log(`   💾 Summary saved: ${summaryFileName}`);
      }

      // Step 3f: Generate PDF and send email
      console.log(`   📧 Generating PDF and sending email...`);
      try {
        const finalState = await generatePdfAndSendEmail(individualMeetingState);
        
        if (finalState.pdfPath && finalState.pdfPath !== 'already-exists') {
          // Mark PDF as generated for deduplication
          markPdfAsGenerated(currentEvent, finalState.pdfPath, eventId);
          
          console.log(`   ✅ PDF generated: ${path.basename(finalState.pdfPath)}`);
          
          // Check if email was sent
          const cprimeAttendee = currentEvent.attendees.find(email => 
            email.toLowerCase().includes('licet.ac.in') || 
            email.toLowerCase().includes('@cprime.com')
          );
          
          if (cprimeAttendee) {
            console.log(`   📧 Email sent to: ${cprimeAttendee}`);
          } else {
            console.log(`   ⚠️  PDF saved but no internal attendee found for email`);
          }
        } else {
          console.log(`   ⚠️  PDF generation completed but no path returned`);
        }
        
      } catch (error) {
        console.error(`   ❌ PDF/Email generation failed:`, error);
        // Continue with next meeting
      }

      console.log(`   ✅ Meeting "${currentEvent.summary}" processed successfully`);

    } catch (error) {
      console.error(`   ❌ Error processing meeting "${currentEvent.summary}":`, error);
      // Continue with next meeting even if this one fails
    }

    // Add small delay between meetings to avoid overwhelming services
    if (i < state.calendarEvents.length - 1) {
      console.log(`   ⏳ Waiting 2 seconds before next meeting...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final summary
  console.log('\n🎉 PIPELINE COMPLETED!');
  console.log('=' .repeat(40));
  console.log(`📊 Results Summary:`);
  console.log(`   - Total client meetings found: ${state.calendarEvents.length}`);
  console.log(`   - Processing completed at: ${new Date().toLocaleString()}`);
  console.log(`   - Check your email and summaries folder for briefing materials`);
  console.log(`   - PDFs are tracked to prevent duplicate generation`);
  console.log(`   - Embeddings are now tracked to prevent duplicates`);
  console.log(`   - LinkedIn/Attendee research integrated into briefings`);
  
  // Show urgency summary
  const urgentMeetings = state.calendarEvents.filter(event => {
    const diffMs = new Date(event.startTime).getTime() - new Date().getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    return diffHours < 1;
  });
  
  if (urgentMeetings.length > 0) {
    console.log(`\n🚨 URGENT MEETINGS (< 1 hour):`);
    urgentMeetings.forEach(event => {
      const timeUntil = getTimeUntilMeeting(event.startTime);
      console.log(`   - ${event.summary} - ${timeUntil}`);
    });
  }

  // Show research summary
  console.log(`\n📊 RESEARCH SUMMARY:`);
  console.log(`   - Company research via Tavily: ${process.env.TAVILY_API_KEY ? 'Enabled' : 'Disabled'}`);
  console.log(`   - Attendee profiles via OpenAI: ${process.env.OPENAI_API_KEY ? 'Enabled' : 'Disabled'}`);
  console.log(`   - Meeting summaries via Gemini: ${process.env.GEMINI_API_KEY ? 'Enabled' : 'Disabled'}`);

  console.log('\n✅ Pre-call preparation pipeline completed successfully!');
}

/**
 * Helper function to calculate time until meeting
 */
function getTimeUntilMeeting(startTime: string): string {
  const now = new Date();
  const meetingTime = new Date(startTime);
  const diffMs = meetingTime.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffMs < 0) {
    return 'Already started';
  } else if (diffHours > 0) {
    return `in ${diffHours}h ${diffMinutes}m`;
  } else {
    return `in ${diffMinutes}m`;
  }
}

/**
 * Helper function to get urgency flag for display
 */
function getUrgencyFlag(startTime: string): string {
  const now = new Date();
  const meetingTime = new Date(startTime);
  const diffMs = meetingTime.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHours < 1) {
    return '🚨 ';
  } else if (diffHours <= 2) {
    return '⏰ ';
  }
  return '';
}

/**
 * Scheduled runner function that can be called periodically
 */
export async function runScheduledPipeline(): Promise<void> {
  const startTime = new Date();
  console.log(`\n⏰ Scheduled pipeline run started at: ${startTime.toLocaleString()}`);
  
  try {
    await main();
  } catch (error) {
    console.error('❌ Scheduled pipeline run failed:', error);
  }
  
  const endTime = new Date();
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
  console.log(`⏱️  Pipeline completed in ${duration} seconds`);
}

// Run the main pipeline
main().catch((err) => {
  console.error('❌ Error in pipeline:', err);
  process.exit(1);
});