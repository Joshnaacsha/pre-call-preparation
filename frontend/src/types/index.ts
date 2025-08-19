export interface Meeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  urgency: 'high' | 'medium' | 'low';
  pdfGenerated?: boolean;
  emailSent?: boolean;
  researchData?: {
    companyNews: string[];
    attendeeProfiles: string[];
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AppState {
  meetings: Meeting[];
  chatMessages: ChatMessage[];
  isAuthenticated: boolean;
  authUrl?: string;
  currentMode: 'landing' | 'oauth' | 'chat' | 'dashboard';
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}