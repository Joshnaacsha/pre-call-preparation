import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import type { GraphState } from '../graph/graphState';
import { embedAndStoreEvent } from '../embeddings/embedAndStore.js';

dotenv.config();

// Define interfaces for chat interaction
interface ChatInput {
  message: string;
  context?: string;
}

interface ExtractedMeetingInfo {
  clientName: string | null;
  projectName: string | null;
  dateTime: string | null;
  goal: string | null;
  attendees: string[];
  skippedFields: string[];
}

interface ChatResponse {
  needsMoreInfo: boolean;
  missingFields: string[];
  extractedInfo: ExtractedMeetingInfo;
  followUpQuestion?: string;
}

// Store conversation state - in production, use Redis or database
const conversationState = new Map<string, ExtractedMeetingInfo>();

/**
 * Process chat input and extract meeting information with context awareness
 */
async function processChatInput(input: ChatInput, sessionId: string = 'default'): Promise<ChatResponse> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Get existing context from conversation state
  const existingInfo = conversationState.get(sessionId) || {
    clientName: null,
    projectName: null,
    dateTime: null,
    goal: null,
    attendees: [],
    skippedFields: []
  };

  const currentTime = new Date().toISOString();

  // If goal exists and projectName doesn't, use goal as projectName
  if (!existingInfo.projectName && existingInfo.goal) {
    existingInfo.projectName = existingInfo.goal;
  }

  const prompt = `
    You are helping collect meeting information. PRESERVE existing information and be SMART about parsing.

    EXISTING STATE (DO NOT LOSE THIS):
    - Client: ${existingInfo.clientName || 'NOT PROVIDED'}
    - Project: ${existingInfo.projectName || 'NOT PROVIDED'}
    - DateTime: ${existingInfo.dateTime || 'NOT PROVIDED'}
    - Goal: ${existingInfo.goal || 'NOT PROVIDED'}
    - Attendees: ${existingInfo.attendees.length > 0 ? existingInfo.attendees.join(', ') : 'NOT PROVIDED'}
    - Skipped Fields: [${existingInfo.skippedFields.join(', ')}]

    NEW USER MESSAGE: "${input.message}"
    CURRENT TIME: ${currentTime}

    CRITICAL RULES:
    1. ALWAYS preserve existing information unless user explicitly changes it
    2. If user says "I don't know", "not sure", "unsure" about a field, add it to skippedFields using exact field names: "clientName", "projectName", "dateTime", "goal", "attendees"
    3. NEVER ask for fields that are in skippedFields
    4. Parse new information intelligently:
       - Company names like "Ford", "Microsoft" = clientName
       - "tomorrow at 2pm" = calculate exact datetime
       - "understand requirements", "networking", "platform maintenance" = both goal AND projectName
       - "me and John" = attendees
    5. If information exists, DON'T mark it as missing
    6. If goal is provided and there's no projectName, use goal as projectName
    7. Technical topics like "platform", "infrastructure", "maintenance" should be considered both goal and projectName

    Return ONLY valid JSON with this EXACT structure:
    {
      "extractedInfo": {
        "clientName": "${existingInfo.clientName}" | extracted_value | null,
        "projectName": "${existingInfo.projectName}" | extracted_value | null,
        "dateTime": "${existingInfo.dateTime}" | extracted_value | null,
        "goal": "${existingInfo.goal}" | extracted_value | null,
        "attendees": [${existingInfo.attendees.map(a => `"${a}"`).join(', ')}] | new_array,
        "skippedFields": [${existingInfo.skippedFields.map(f => `"${f}"`).join(', ')}] | updated_array
      }
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    let rawText = result.response.text().trim();
    
    // Clean up response
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/```[a-z]*\n?/, "").replace(/```$/, "");
    }

    const parsedResponse = JSON.parse(rawText);
    
    // Build the complete response
    const extractedInfo = parsedResponse.extractedInfo;
    
    // Update conversation state immediately
    conversationState.set(sessionId, extractedInfo);

    // Calculate truly missing fields (excluding skipped ones and using goal as project name if needed)
    const missingFields = [];
    const skipped = extractedInfo.skippedFields || [];

    // If projectName is not provided but goal is, use goal as projectName
    if (!extractedInfo.projectName && extractedInfo.goal) {
      extractedInfo.projectName = extractedInfo.goal;
    }
    
    if (!extractedInfo.clientName && !skipped.includes('clientName')) {
      missingFields.push('clientName');
    }
    if (!extractedInfo.projectName && !extractedInfo.goal && !skipped.includes('projectName')) {
      missingFields.push('projectName');
    }
    if (!extractedInfo.dateTime && !skipped.includes('dateTime')) {
      missingFields.push('dateTime');
    }
    if (!extractedInfo.goal && !skipped.includes('goal')) {
      missingFields.push('goal');
    }
    if (extractedInfo.attendees.length === 0 && !skipped.includes('attendees')) {
      missingFields.push('attendees');
    }

    const response: ChatResponse = {
      extractedInfo,
      missingFields,
      needsMoreInfo: missingFields.length > 0,
      followUpQuestion: missingFields.length > 0 ? generateSmartFollowUpQuestion(missingFields) : undefined
    };

    console.log('✅ Processed chat input:', {
      preserved: existingInfo,
      extracted: response.extractedInfo,
      missing: missingFields,
      skipped: extractedInfo.skippedFields,
      needsMore: response.needsMoreInfo
    });

    return response;
  } catch (error) {
    console.error('Error processing chat input:', error);
    throw new Error('Failed to process chat input');
  }
}

/**
 * Generate concise, smart follow-up questions
 */
function generateSmartFollowUpQuestion(missingFields: string[]): string {
  if (missingFields.length === 0) return "";

  const questions: { [key: string]: string } = {
    clientName: "Who's the client?",
    projectName: "What's the project about?",
    dateTime: "When is the meeting?",
    goal: "What's the purpose?",
    attendees: "Who else will be there?"
  };

  if (missingFields.length === 1) {
    return questions[missingFields[0]] || "Any other details?";
  }

  if (missingFields.length === 2) {
    const q1 = questions[missingFields[0]];
    const q2 = questions[missingFields[1]].toLowerCase().replace('?', '');
    return `${q1} And ${q2}?`;
  }

  // For 3+ fields, ask for the most important ones
  const priority = ['dateTime', 'goal', 'attendees'];
  const importantMissing = missingFields.filter(f => priority.includes(f));
  
  if (importantMissing.length > 0) {
    const firstField = importantMissing[0];
    return questions[firstField];
  }

  return "What other details can you share?";
}

/**
 * Convert extracted meeting info to GraphState format
 */
function convertToGraphState(info: ExtractedMeetingInfo): GraphState {
  let meetingTime = new Date();

  if (info.dateTime) {
    try {
      // Handle ISO strings directly
      if (info.dateTime.includes('T')) {
        meetingTime = new Date(info.dateTime);
      } else if (info.dateTime.toLowerCase().includes('tomorrow')) {
        // Handle "tomorrow at 2pm" etc
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const timeMatch = info.dateTime.match(/(\d{1,2})\s*(am|pm)/i);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1]);
          const isPM = timeMatch[2].toLowerCase() === 'pm';
          if (isPM && hour !== 12) hour += 12;
          if (!isPM && hour === 12) hour = 0;
          
          tomorrow.setHours(hour, 0, 0, 0);
          meetingTime = tomorrow;
        }
      } else {
        // Try direct parsing
        const parsed = new Date(info.dateTime);
        if (!isNaN(parsed.getTime())) {
          meetingTime = parsed;
        }
      }
    } catch (error) {
      console.warn('Error parsing dateTime:', error);
      // Fall back to current time + 1 hour
      meetingTime = new Date(Date.now() + 3600000);
    }
  }
  
  return {
    calendarEvents: [{
      summary: `${info.clientName || 'Meeting'} - ${info.projectName || 'Discussion'}`,
      description: info.goal || 'Meeting discussion',
      startTime: meetingTime.toISOString(),
      attendees: info.attendees,
      location: '',
    }],
    externalResearch: {
      searchQuery: `${info.clientName || ''} ${info.projectName || ''}`.trim(),
      companyNews: '',
      contactUpdates: '',
    },
  };
}

/**
 * Clear conversation state
 */
export function clearConversationState(sessionId: string = 'default'): void {
  conversationState.delete(sessionId);
}

/**
 * Get current conversation state
 */
export function getConversationState(sessionId: string = 'default'): ExtractedMeetingInfo | undefined {
  return conversationState.get(sessionId);
}

/**
 * Get the latest generated summary for a meeting
 */
async function getLatestSummary(meetingSummary: string): Promise<string | null> {
  try {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    
    const summariesDir = path.join(process.cwd(), 'summaries');
    
    // Check if summaries directory exists
    try {
      await fs.access(summariesDir);
    } catch {
      console.log('📁 Summaries directory not found');
      return null;
    }

    // Read all files in summaries directory
    const files = await fs.readdir(summariesDir);
    
    // Filter for markdown files that match the meeting
    const cleanMeetingName = meetingSummary
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    const matchingFiles = files.filter((file: string) => 
      file.startsWith('briefing-') && 
      file.includes(cleanMeetingName) && 
      file.endsWith('.md')
    );

    if (matchingFiles.length === 0) {
      console.log(`📄 No summary file found for: ${meetingSummary}`);
      return null;
    }

    // Get the most recent file (sort by filename which includes timestamp)
    const latestFile = matchingFiles.sort().reverse()[0];
    const filePath = path.join(summariesDir, latestFile);
    
    console.log(`📖 Reading summary file: ${latestFile}`);
    const summaryContent = await fs.readFile(filePath, 'utf-8');
    
    return summaryContent;
  } catch (error) {
    console.error('Error reading summary file:', error);
    return null;
  }
}

/**
 * Main chat agent handler
 */
export async function handleChatRequest(
  input: ChatInput,
  sessionId: string = 'default'
): Promise<{ 
  graphState: GraphState | null; 
  needsMoreInfo: boolean; 
  followUpQuestion?: string;
  summary?: string; 
}> {
  const chatResponse = await processChatInput(input, sessionId);

  if (chatResponse.needsMoreInfo) {
    return {
      graphState: null,
      needsMoreInfo: true,
      followUpQuestion: chatResponse.followUpQuestion
    };
  }

  const graphState = convertToGraphState(chatResponse.extractedInfo);
  
  // Store in database
  try {
    const event = {
      summary: `${chatResponse.extractedInfo.clientName || 'Meeting'} - ${chatResponse.extractedInfo.projectName || 'Discussion'}`,
      description: chatResponse.extractedInfo.goal || '',
      startTime: graphState.calendarEvents[0].startTime,
      attendees: chatResponse.extractedInfo.attendees,
      location: '',
      metadata: {
        client_name: chatResponse.extractedInfo.clientName,
        project_name: chatResponse.extractedInfo.projectName,
        session_id: sessionId,
        final_state: true
      }
    };
    await embedAndStoreEvent(event);
    console.log('📊 Successfully stored meeting data');
  } catch (error) {
    console.error('Failed to store chat data:', error);
  }

  // Clear state after success
  conversationState.delete(sessionId);
  
  // Try to get the generated summary after pipeline completion
  let summary: string | null = null;
  try {
    const meetingTitle = `${chatResponse.extractedInfo.clientName || 'Meeting'} - ${chatResponse.extractedInfo.projectName || 'Discussion'}`;
    console.log(`🔍 Looking for generated summary for: ${meetingTitle}`);
    
    // Wait longer for the pipeline to complete file generation (increased from 1 second to 3 seconds)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    summary = await getLatestSummary(meetingTitle);
    
    if (summary) {
      console.log(`✅ Summary retrieved successfully (${summary.length} characters)`);
    } else {
      console.log('⚠️ No summary found after pipeline completion');
      
      // Try one more time with a longer wait
      console.log('🔄 Retrying summary retrieval after additional wait...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      summary = await getLatestSummary(meetingTitle);
      
      if (summary) {
        console.log(`✅ Summary retrieved on retry (${summary.length} characters)`);
      } else {
        console.log('❌ Summary still not found after retry');
      }
    }
  } catch (error) {
    console.error('Error retrieving summary:', error);
  }
  
  return {
    graphState,
    needsMoreInfo: false,
    summary: summary || undefined
  };
}

// API types
export interface ChatRequestBody {
  message: string;
  context?: string;
  sessionId?: string;
}

export interface ChatResponseBody {
  success: boolean;
  needsMoreInfo: boolean;
  followUpQuestion?: string;
  graphState?: GraphState;
  summary?: string;
  error?: string;
  currentState?: ExtractedMeetingInfo;
}