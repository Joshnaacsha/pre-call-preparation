export interface Meeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  urgency: 'low' | 'medium' | 'high';
  pdfGenerated: boolean;
  emailSent: boolean;
}

export interface ChatMessage {
  id: string;
  content: string;
  timestamp: number;
  role: 'user' | 'assistant';
}

export interface AppState {
  meetings: Meeting[];
  chatMessages: ChatMessage[];
  isAuthenticated: boolean;
  currentMode: 'landing' | 'chat' | 'oauth';
  authUrl?: string;
  lastAuthStatus: string | null;
  pipelineStatus: 'idle' | 'starting' | 'completed' | 'error';
  redirectAfterAuth?: string;
}
