import OpenAI from 'openai';
import dotenv from 'dotenv';
import type { GraphState } from '../graph/graphState';
import { embedAndStoreEvent } from '../embeddings/embedAndStore.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define interfaces for chat interaction
interface ChatInput {
  message: string;
  context?: string;
  sessionId?: string;
}

interface ExtractedMeetingInfo {
  clientName: string | null;
  projectName: string | null;
  dateTime: string | null;
  goal: string | null;
  attendees: string[];
  skippedFields: string[];
  lastQuestion?: string;
}

interface ChatResponse {
  needsMoreInfo: boolean;
  missingFields: string[];
  extractedInfo: ExtractedMeetingInfo;
  followUpQuestion?: string;
}

// Session states for efficient routing
enum SessionState {
  IDLE = 'idle',
  COLLECTING_INFO = 'collecting_info',
  PROCESSING = 'processing'
}

interface ConversationContext {
  state: SessionState;
  extractedInfo: ExtractedMeetingInfo;
  requiredFields: string[];
  completedFields: string[];
  lastUpdated: Date;
}

// Store conversation contexts - in production, use Redis or database
const conversationContexts = new Map<string, ConversationContext>();

// Session cleanup - remove old sessions after 30 minutes of inactivity
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
setInterval(() => {
  const now = new Date();
  for (const [sessionId, context] of conversationContexts.entries()) {
    if (now.getTime() - context.lastUpdated.getTime() > SESSION_TIMEOUT) {
      conversationContexts.delete(sessionId);
      console.log(`[Cleanup] Cleaned up expired session: ${sessionId}`);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

/**
 * Get or create conversation context for a session
 */
function getOrCreateContext(sessionId: string): ConversationContext {
  if (!conversationContexts.has(sessionId)) {
    conversationContexts.set(sessionId, {
      state: SessionState.IDLE,
      extractedInfo: {
        clientName: null,
        projectName: null,
        dateTime: null,
        goal: null,
        attendees: [],
        skippedFields: []
      },
      requiredFields: ['clientName', 'projectName', 'dateTime', 'attendees'],
      completedFields: [],
      lastUpdated: new Date()
    });
  }
  
  const context = conversationContexts.get(sessionId)!;
  context.lastUpdated = new Date();
  return context;
}

/**
 * Update conversation context
 */
function updateContext(sessionId: string, updates: Partial<ConversationContext>): void {
  const context = getOrCreateContext(sessionId);
  Object.assign(context, updates);
  context.lastUpdated = new Date();
}

/**
 * Check if message indicates intent to prepare a meeting
 */
function isMeetingPreparationIntent(message: string): boolean {
  const msg = message.toLowerCase().trim();
  
  // Compiled regex for efficiency
  const meetingPatterns = /\b(prepare|meeting|client|tomorrow|today|next week|schedule|brief|get summary)\b/i;
  const newClientPattern = /new client/i;
  
  return meetingPatterns.test(msg) || newClientPattern.test(msg);
}

/**
 * Check if user is expressing uncertainty
 */
function isUncertainResponse(message: string): boolean {
  const uncertaintyPatterns = /\b(not sure|maybe|probably|don't know|unsure|unknown|can't tell|uncertain|possible|might be)\b/i;
  return uncertaintyPatterns.test(message.toLowerCase());
}

/**
 * Process chat input and extract meeting information with context awareness
 */
async function processChatInput(input: ChatInput, sessionId: string = 'default'): Promise<ChatResponse> {
  const context = getOrCreateContext(sessionId);
  const message = input.message.toLowerCase();
  const isUncertain = isUncertainResponse(input.message);

  // Get existing info from context
    const existingInfo = {
    ...context.extractedInfo,
    // If a field is already set, don't lose it
    clientName: context.extractedInfo.clientName || null,
    projectName: context.extractedInfo.projectName || null,
    dateTime: context.extractedInfo.dateTime || null,
    goal: context.extractedInfo.goal || null,
    attendees: [...(context.extractedInfo.attendees || [])],
    skippedFields: [...(context.extractedInfo.skippedFields || [])]
  };

  // If the response expresses uncertainty, mark appropriate field as skipped
  if (isUncertain) {
    const lastQuestion = existingInfo.lastQuestion;
    if (lastQuestion?.startsWith('Who else')) {
      existingInfo.skippedFields.push('attendees');
    }
  }

  const currentTime = new Date().toISOString();  // If goal exists and projectName doesn't, use goal as projectName
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
    2. If user gives any form of uncertain response ("I don't know", "not sure", "unsure", "unknown", "maybe", "probably", etc.) 
       or expresses uncertainty about a field, IMMEDIATELY add it to skippedFields using exact field names: 
       "clientName", "projectName", "dateTime", "goal", "attendees"
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
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });
    
    let rawText = aiResponse.choices[0].message.content?.trim() || "";
    
    // Clean up response
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/```[a-z]*\n?/, "").replace(/```$/, "");
    }

    const parsedResponse = JSON.parse(rawText);
    
    // Build the complete response, merging with existing info
    const extractedInfo = {
      ...existingInfo,  // Keep existing values as base
      ...parsedResponse.extractedInfo,  // Override with new values
      // Merge arrays properly
      attendees: [...new Set([...existingInfo.attendees, ...(parsedResponse.extractedInfo.attendees || [])])],
      skippedFields: [...new Set([...existingInfo.skippedFields, ...(parsedResponse.extractedInfo.skippedFields || [])])]
    };
    
    // Update conversation context immediately
    context.extractedInfo = extractedInfo;
    updateContext(sessionId, { extractedInfo });

    // Calculate truly missing fields
    const missingFields = [];
    const skipped = extractedInfo.skippedFields || [];

    // Mark field as skipped if uncertainty is expressed
    if (isUncertain) {
      if (!extractedInfo.clientName && !skipped.includes('clientName')) {
        skipped.push('clientName');
      }
      if (!extractedInfo.projectName && !extractedInfo.goal && !skipped.includes('projectName')) {
        skipped.push('projectName');
      }
      if (!extractedInfo.dateTime && !skipped.includes('dateTime')) {
        skipped.push('dateTime');
      }
      if (!extractedInfo.goal && !skipped.includes('goal')) {
        skipped.push('goal');
      }
      if (extractedInfo.attendees.length === 0 && !skipped.includes('attendees')) {
        skipped.push('attendees');
      }
    }

    // If projectName is not provided but goal is, use goal as projectName
    if (!extractedInfo.projectName && extractedInfo.goal) {
      extractedInfo.projectName = extractedInfo.goal;
    }
  
    // Update missing fields list (after marking uncertain fields as skipped)
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

    console.log('[Info] Processed chat input:', {
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
    dateTime: "When is the meeting scheduled?",
    goal: "What's the purpose of the meet?",
    attendees: "Could you tell me who else will be attending? (Or say 'not sure' if unknown)"
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
  conversationContexts.delete(sessionId);
}

/**
 * Get current conversation state
 */
export function getConversationState(sessionId: string = 'default'): ExtractedMeetingInfo | undefined {
  const context = conversationContexts.get(sessionId);
  return context?.extractedInfo;
}

/**
 * Check if session is actively collecting meeting info
 */
export function isActiveSession(sessionId: string = 'default'): boolean {
  const context = conversationContexts.get(sessionId);
  return context?.state === SessionState.COLLECTING_INFO;
}

/**
 * Start a new meeting preparation session
 */
export function startMeetingSession(sessionId: string = 'default'): void {
  updateContext(sessionId, { state: SessionState.COLLECTING_INFO });
}

/**
 * Check if message is a meeting preparation intent
 */
export function isMeetingIntent(message: string): boolean {
  return isMeetingPreparationIntent(message);
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
  // Process the chat input first
  const response = await processChatInput(input, sessionId);
  const info = response.extractedInfo;

  // Helper to check if a field should be considered "complete"
  const isFieldComplete = (field: string): boolean => {
    if (info.skippedFields.includes(field)) {
      console.log(`[Info] Field "${field}" marked as skipped`);
      return true;
    }
    
    switch(field) {
      case 'clientName':
        return !!info.clientName;
      case 'projectName':
        return !!(info.projectName || info.goal);
      case 'goal':
        return !!(info.goal || info.projectName);
      case 'dateTime':
        return !!info.dateTime;
      case 'attendees':
        return info.attendees.length > 0 || info.skippedFields.includes('attendees');
      default:
        return false;
    }
  };

  // Check if all required fields are either filled or skipped
  const requiredFields = ['clientName', 'projectName', 'dateTime', 'attendees'];
  const nextMissingField = requiredFields.find(field => !isFieldComplete(field));

  // If we still need more info, ask the next question
  if (nextMissingField) {
    console.log(`[Info] Missing field: ${nextMissingField}`);
    // Keep session active
    updateContext(sessionId, { state: SessionState.COLLECTING_INFO });
    return {
      graphState: null,
      needsMoreInfo: true,
      followUpQuestion: generateSmartFollowUpQuestion([nextMissingField])
    };
  }

  // All fields are complete or skipped, proceed with storing and generating summary
  updateContext(sessionId, { state: SessionState.PROCESSING });
  const graphState = convertToGraphState(info);

  try {
    // Store in database
    const event = {
      summary: `${info.clientName || 'Meeting'} - ${info.projectName || info.goal || 'Discussion'}`,
      description: info.goal || '',
      startTime: graphState.calendarEvents[0].startTime,
      attendees: info.attendees,
      location: '',
      metadata: {
        client_name: info.clientName,
        project_name: info.projectName || info.goal,
        meeting_goal: info.goal,
        session_id: sessionId,
        final_state: true,
        skipped_fields: info.skippedFields
      }
    };

    await embedAndStoreEvent(event);
    console.log('[Success] Successfully stored meeting data');

    // Generate summary using the main pipeline
    const { generateMeetingSummary } = await import('./summaryGenarationAgent.js');
    const summaryState = await generateMeetingSummary(graphState);
    
    if (summaryState.summary) {
      // Clear conversation state since we're done
      clearConversationState(sessionId);
      
      return {
        graphState,
        needsMoreInfo: false,
        summary: summaryState.summary
      };
    }

    // If we get here, something went wrong with summary generation
    console.error('[Error] Failed to generate summary');
    return {
      graphState: null,
      needsMoreInfo: true,
      followUpQuestion: "I'm sorry, there was an error processing your request. Could you try again?"
    };
    
  } catch (error) {
    console.error('[Error] Failed to process meeting:', error);
    return {
      graphState: null,
      needsMoreInfo: true,
      followUpQuestion: "I'm sorry, there was an error processing your request. Could you try again?"
    };
  }
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