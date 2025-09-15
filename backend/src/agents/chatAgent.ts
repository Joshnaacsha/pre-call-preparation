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
  goal: string | null;
  dateTime: string | null;
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

// Helper function to generate follow-up questions
async function generateFollowUpQuestion(missingFields: string[], extractedInfo?: ExtractedMeetingInfo): Promise<string> {
  if (missingFields.length === 0) return "";

  const prompt = `
Given the current meeting preparation context, generate a natural follow-up question to gather missing information.

CURRENT INFO:
${JSON.stringify(extractedInfo, null, 2)}

MISSING FIELD: ${missingFields[0]}

INSTRUCTIONS:
1. Generate ONE clear, conversational question to get the missing information
2. Keep the question natural and friendly, not rigid or formal
3. Include helpful context or examples if relevant
4. For attendees, ask if it's one person or multiple people when names are ambiguous
5. Allow for "not sure" responses

Example variations:
- clientName: "Which company are we meeting with?"
- projectName: "Can you tell me what this meeting is about?"
- dateTime: "When would you like to schedule this?"
- attendees: "Who will be joining us from their side?"
- goal: "What's the main thing you want to achieve in this meeting?"

Return ONLY the question text with no additional formatting or explanation.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const question = completion.choices[0].message.content?.trim() || "Can you provide more details?";
    
    // Store the question for context
    if (extractedInfo) {
      extractedInfo.lastQuestion = question;
    }
    
    return question;
  } catch (error) {
    console.error('Error generating question:', error);
    // Fallback to basic questions if LLM fails
    const fallbackQuestions: { [key: string]: string } = {
      clientName: "What's the name of the client or company?",
      projectName: "What's the project or main topic for this meeting?",
      dateTime: "When is the meeting scheduled?",
      goal: "What's the main purpose or goal of this meeting?",
      attendees: "Who else will be attending? (You can say 'not sure' if unknown)"
    };
    const question = fallbackQuestions[missingFields[0]] || "Can you provide more details?";
    if (extractedInfo) {
      extractedInfo.lastQuestion = question;
    }
    return question;
  }
}

interface ChatResponse {
  needsMoreInfo: boolean;
  missingFields: string[];
  extractedInfo: ExtractedMeetingInfo;
  followUpQuestion?: string;
}

// Sync question generator with improved name handling
function generateNextQuestion(field: string): string {
  const questions: { [key: string]: string } = {
    clientName: "What's the name of the client or company?",
    projectName: "What's the project or main topic for this meeting?",
    dateTime: "When is the meeting scheduled?",
    goal: "What's the main purpose or goal of this meeting?",
    attendees: "Who will be joining the meeting? If you mention multiple names, please clarify if they are separate people or one person's full name."
  };
  return questions[field] || "Can you provide more details?";
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
export const conversationContexts = new Map<string, ConversationContext>();

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
 * IMPROVED: Process chat input using LLM for better understanding
 */
async function processChatInput(input: ChatInput, sessionId: string = 'default'): Promise<ChatResponse> {
  const context = getOrCreateContext(sessionId);
  const currentTime = new Date().toISOString();

  // Get existing info from context
  const existingInfo: ExtractedMeetingInfo = {
    ...context.extractedInfo
  };

  // Handle clarification responses for name ambiguity
  const isNameClarification = existingInfo.lastQuestion?.includes('one person, or are') || false;
  if (isNameClarification) {
    const response = input.message.toLowerCase().trim();
    const isOnePerson = response.includes('one') || response.includes('same') || response.includes('single');
    const isTwoPeople = response.includes('two') || response.includes('different') || response.includes('separate');
    
    if (isOnePerson || isTwoPeople) {
      // Get the last extracted attendees that caused the clarification
      const lastAttendees = existingInfo.attendees;
      if (lastAttendees.length >= 2) {
        if (isOnePerson) {
          // Combine into one full name
          existingInfo.attendees = [lastAttendees.join(' ')];
          console.log('[Clarification] Combined into one person:', existingInfo.attendees[0]);
        } else {
          // Keep as separate people
          console.log('[Clarification] Keeping as separate people:', lastAttendees);
        }
        
        // Mark attendees as completed since we resolved the ambiguity
        if (!context.completedFields.includes('attendees')) {
          context.completedFields.push('attendees');
        }
        
        // Update context and proceed to next field
        context.extractedInfo = existingInfo;
        updateContext(sessionId, { 
          extractedInfo: existingInfo,
          completedFields: context.completedFields
        });
        
        // Calculate missing fields and continue
        const missingFields = [];
        const requiredFields = ['clientName', 'projectName', 'dateTime', 'attendees'];
        
        for (const field of requiredFields) {
          const isCompleted = context.completedFields.includes(field);
          const isSkipped = existingInfo.skippedFields.includes(field);
          
          if (!isCompleted && !isSkipped) {
            missingFields.push(field);
          }
        }

        // Generate next question synchronously
        let followUpQuestion: string | undefined;
        if (missingFields.length > 0) {
          followUpQuestion = generateNextQuestion(missingFields[0]);
          if (existingInfo) {
            existingInfo.lastQuestion = followUpQuestion;
          }
        }
        
        return {
          extractedInfo: existingInfo,
          missingFields,
          needsMoreInfo: missingFields.length > 0,
          followUpQuestion
        };
      }
    }
  }

    // Clean and validate input message
    const cleanMessage = input.message.replace(/[()]/g, '').trim();
    
    const prompt = `
You are an intelligent meeting preparation assistant. Your job is to extract meeting information from user responses and understand context. NEVER modify or interpret client names - use them exactly as provided.

CURRENT CONVERSATION STATE:
- Last Question: "${existingInfo.lastQuestion || 'Initial request'}"
- User Response: "${cleanMessage}"
- Current Time: ${currentTime}EXISTING MEETING INFO:
- Client: ${existingInfo.clientName || 'NOT PROVIDED'}
- Project: ${existingInfo.projectName || 'NOT PROVIDED'}
- Date/Time: ${existingInfo.dateTime || 'NOT PROVIDED'}
- Goal: ${existingInfo.goal || 'NOT PROVIDED'}
- Attendees: ${existingInfo.attendees.length > 0 ? existingInfo.attendees.join(', ') : 'NOT PROVIDED'}
- Skipped Fields: [${existingInfo.skippedFields.join(', ')}]

INSTRUCTIONS:
1. UNDERSTAND THE CONTEXT: If we just asked "Who's the client?" and the user responds with "kissflow" or "Kissflow", that IS the client name.

2. EXTRACT ALL INFORMATION: Look for any meeting details in the user's message:
   - Client names (company names, organizations) - IMPORTANT: Extract exact names as provided (e.g., "sagent" should stay as "Sagent")
   - Project names or topics (preserve exact spelling)
   - Date/time references (tomorrow, 2pm, next week, etc.)
   - Goals or purposes
   - People's names (attendees)

3. PRESERVE EXISTING DATA: Keep all previously extracted information unless explicitly changed.

4. HANDLE UNCERTAINTY: If user says "not sure", "don't know", "unknown", mark that field as skipped.

5. BE SMART ABOUT RESPONSES: 
   - "sagent" in initial request or in response to "Who's the client?" = clientName: "Sagent"
   - "tomorrow at 2pm" = dateTime: "tomorrow at 2pm"  
   - "Jerome Christopher" = attendees: ["Jerome Christopher"]
   - DO NOT modify or "correct" client names - use them exactly as provided

RESPONSE FORMAT: Return ONLY valid JSON with this exact structure:
{
  "extractedInfo": {
    "clientName": "${existingInfo.clientName || 'null'}" | "extracted_value" | null,
    "projectName": "${existingInfo.projectName || 'null'}" | "extracted_value" | null,
    "dateTime": "${existingInfo.dateTime || 'null'}" | "extracted_value" | null,
    "goal": "${existingInfo.goal || 'null'}" | "extracted_value" | null,
    "attendees": ${JSON.stringify(existingInfo.attendees)} | ["new_attendee1", "new_attendee2"],
    "skippedFields": ${JSON.stringify(existingInfo.skippedFields)} | ["field1", "field2"]
  },
  "reasoning": "Brief explanation of what you extracted and why"
}

EXAMPLES:
User: "kissflow" (after being asked about client)
Response: {"extractedInfo": {"clientName": "Kissflow", ...}, "reasoning": "User provided 'kissflow' as client name"}

User: "Jerome Christopher will attend" 
Response: {"extractedInfo": {"attendees": ["Jerome Christopher"], ...}, "reasoning": "Extracted attendee name"}

User: "not sure about attendees"
Response: {"extractedInfo": {"skippedFields": ["attendees"], ...}, "reasoning": "User expressed uncertainty about attendees"}
`;

  try {
    // First, check if we're overriding previous incorrect data
    if (input.message.toLowerCase().includes('not') && input.message.toLowerCase().includes('kissflow')) {
      // Clear any existing data and force client name update
      existingInfo.clientName = null;
      existingInfo.projectName = null;
      context.completedFields = context.completedFields.filter(f => f !== 'clientName' && f !== 'projectName');
      console.log('[Correction] Clearing incorrect client data');
    }

    // Extract initial client name from first message if present
    if (cleanMessage.toLowerCase().includes('sagent') && !existingInfo.clientName) {
      existingInfo.clientName = 'Sagent';
      if (!context.completedFields.includes('clientName')) {
        context.completedFields.push('clientName');
      }
      console.log('[Info] Detected initial client name: Sagent');
    }

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3, // Lower temperature for more consistent extraction
    });
    
    let rawText = aiResponse.choices[0].message.content?.trim() || "";
    
    // Clean up response
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/```[a-z]*\n?/, "").replace(/```$/, "");
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(rawText);
    } catch (parseError) {
      console.error('[Error] Failed to parse AI response:', parseError);
      console.error('[Error] Raw AI response:', rawText);
      throw new Error('Failed to parse AI response');
    }

    // Update the extracted info
    const updatedInfo: ExtractedMeetingInfo = {
      ...existingInfo,
      ...parsedResponse.extractedInfo,
      // Ensure arrays are properly handled
      attendees: parsedResponse.extractedInfo.attendees || existingInfo.attendees,
      skippedFields: parsedResponse.extractedInfo.skippedFields || existingInfo.skippedFields
    };

    // Check for name ambiguity
    if (updatedInfo.attendees.length >= 2 && !context.completedFields.includes('attendees')) {
      // Check if we might have a full name vs multiple people
      const potentialFullName = updatedInfo.attendees.join(' ');
      const clarificationNeeded = !potentialFullName.includes(',') && 
        !input.message.toLowerCase().includes(' and ') &&
        !input.message.toLowerCase().includes(' with ');
      
      if (clarificationNeeded) {
        const question = `Is "${potentialFullName}" one person's full name, or are these different people? Please clarify.`;
        updatedInfo.lastQuestion = question;
        return {
          extractedInfo: updatedInfo,
          missingFields: ['attendees'],
          needsMoreInfo: true,
          followUpQuestion: question
        };
      }
    }

    console.log('[LLM] Extraction reasoning:', parsedResponse.reasoning);
    console.log('[LLM] Updated info:', updatedInfo);

    // Update context with new information
    context.extractedInfo = updatedInfo;

    // Smart completion tracking - mark fields as completed based on what we have
    let newCompletedFields = [...context.completedFields];
    
    // Clear any incorrect company names
    if (input.message.toLowerCase().includes('not') && 
        input.message.toLowerCase().includes('kissflow') &&
        updatedInfo.clientName?.toLowerCase().includes('kissflow')) {
      updatedInfo.clientName = null;
      newCompletedFields = newCompletedFields.filter(f => f !== 'clientName');
      console.log('[Correction] Cleared incorrect client name');
    }
    
    if (updatedInfo.clientName && !newCompletedFields.includes('clientName')) {
      // Double check we're not using any incorrect cached data
      const isCorrection = input.message.toLowerCase().includes('not') && 
                          input.message.toLowerCase().includes(updatedInfo.clientName.toLowerCase());
      if (!isCorrection) {
        newCompletedFields.push('clientName');
        console.log('[Complete] Marked clientName as completed:', updatedInfo.clientName);
      }
    }
    
    if ((updatedInfo.projectName || updatedInfo.goal) && !newCompletedFields.includes('projectName')) {
      newCompletedFields.push('projectName');
      console.log('[Complete] Marked projectName as completed');
    }
    
    if (updatedInfo.dateTime && !newCompletedFields.includes('dateTime')) {
      newCompletedFields.push('dateTime');
      console.log('[Complete] Marked dateTime as completed:', updatedInfo.dateTime);
    }
    
    if ((updatedInfo.attendees.length > 0 || updatedInfo.skippedFields.includes('attendees')) && 
        !newCompletedFields.includes('attendees')) {
      newCompletedFields.push('attendees');
      console.log('[Complete] Marked attendees as completed:', updatedInfo.attendees);
    }

    context.completedFields = newCompletedFields;
    updateContext(sessionId, { 
      extractedInfo: updatedInfo,
      completedFields: newCompletedFields
    });

    // Check for potential name ambiguity in attendees
    if (updatedInfo.attendees.length >= 2 && !context.completedFields.includes('attendees')) {
      const attendeeNames = updatedInfo.attendees;
      const needsNameClarification = attendeeNames.every(name => !name.includes(' ')); // Check if we have multiple single-word names
      
      if (needsNameClarification) {
        // Store current state for clarification
        updatedInfo.lastQuestion = `Is "${attendeeNames.join(' ')}" one person, or are these different people? Please clarify.`;
        context.extractedInfo = updatedInfo;
        
        return {
          extractedInfo: updatedInfo,
          missingFields: ['attendees'],
          needsMoreInfo: true,
          followUpQuestion: updatedInfo.lastQuestion
        };
      }
    }

    // Calculate missing fields
    const missingFields = [];
    const requiredFields = ['clientName', 'projectName', 'dateTime', 'attendees'];
    
    for (const field of requiredFields) {
      const isCompleted = newCompletedFields.includes(field);
      const isSkipped = updatedInfo.skippedFields.includes(field);
      
      if (!isCompleted && !isSkipped) {
        missingFields.push(field);
      }
    }

    // Name clarification is handled above
    const needsNameClarification = false;
    const clarificationQuestion = undefined;

    // Generate follow-up question synchronously
    let followUpQuestion: string | undefined;
    if (missingFields.length > 0) {
      followUpQuestion = generateNextQuestion(missingFields[0]);
      if (updatedInfo) {
        updatedInfo.lastQuestion = followUpQuestion;
      }
    }

    const response: ChatResponse = {
      extractedInfo: updatedInfo,
      missingFields,
      needsMoreInfo: missingFields.length > 0,
      followUpQuestion
    };

    console.log('[Success] Processed chat input:', {
      extracted: updatedInfo,
      completed: newCompletedFields,
      missing: missingFields,
      needsMore: response.needsMoreInfo
    });

    return response;
  } catch (error) {
    console.error('Error processing chat input:', error);
    throw new Error('Failed to process chat input');
  }
}

/**
 * Generate smarter follow-up questions
 */
async function generateSmartFollowUpQuestion(missingFields: string[], extractedInfo?: ExtractedMeetingInfo): Promise<string> {
  if (missingFields.length === 0) return "";

  const prompt = `
Given the current meeting preparation context, generate a natural follow-up question to gather missing information.

CURRENT INFO:
${JSON.stringify(extractedInfo, null, 2)}

MISSING FIELD: ${missingFields[0]}

INSTRUCTIONS:
1. Generate ONE clear, conversational question to get the missing information
2. Keep the question natural and friendly, not rigid or formal
3. Include helpful context or examples if relevant
4. For attendees, ask if it's one person or multiple people when names are ambiguous
5. Allow for "not sure" responses

Example variations:
- clientName: "Which company are we meeting with?"
- projectName: "Can you tell me what this meeting is about?"
- dateTime: "When would you like to schedule this?"
- attendees: "Who will be joining us from their side?"
- goal: "What's the main thing you want to achieve in this meeting?"

Return ONLY the question text with no additional formatting or explanation.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const question = completion.choices[0].message.content?.trim() || "Can you provide more details?";
    
    // Store the question for context
    if (extractedInfo) {
      extractedInfo.lastQuestion = question;
    }
    
    return question;
  } catch (error) {
    console.error('Error generating question:', error);
    // Fallback to basic questions if LLM fails
    const fallbackQuestions: { [key: string]: string } = {
      clientName: "What's the name of the client or company?",
      projectName: "What's the project or main topic for this meeting?",
      dateTime: "When is the meeting scheduled?",
      goal: "What's the main purpose or goal of this meeting?",
      attendees: "Who else will be attending? (You can say 'not sure' if unknown)"
    };
    const question = fallbackQuestions[missingFields[0]] || "Can you provide more details?";
    if (extractedInfo) {
      extractedInfo.lastQuestion = question;
    }
    return question;
  }
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
 * Main chat agent handler - IMPROVED
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
  // Process the chat input using improved LLM understanding
  const response = await processChatInput(input, sessionId);
  const info = response.extractedInfo;
  const context = getOrCreateContext(sessionId);

  console.log('[Handler] Processing result:', {
    needsMoreInfo: response.needsMoreInfo,
    missingFields: response.missingFields,
    extractedInfo: info
  });

  // If we still need more info, ask the next question
  if (response.needsMoreInfo) {
    updateContext(sessionId, { state: SessionState.COLLECTING_INFO });
    
    return {
      graphState: null,
      needsMoreInfo: true,
      followUpQuestion: response.followUpQuestion
    };
  }

  // All fields are complete, proceed with storing and generating summary
  updateContext(sessionId, { state: SessionState.PROCESSING });
  const graphState = convertToGraphState(info);

  try {
    // Clean and sanitize data for storage
    const sanitizedClientName = info.clientName?.replace(/[()]/g, '').trim() || 'Meeting';
    const sanitizedProjectName = (info.projectName || info.goal || 'Discussion').replace(/[()]/g, '').trim();
    const sanitizedGoal = info.goal?.replace(/[()]/g, '').trim() || '';
    
    // Store in database with sanitized data
    const event = {
      summary: `${sanitizedClientName} - ${sanitizedProjectName}`,
      description: sanitizedGoal,
      startTime: graphState.calendarEvents[0].startTime,
      attendees: info.attendees.map(att => att.replace(/[()]/g, '').trim()),
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