import { ApiResponse, ChatMessage } from '../types';

const API_BASE = '';

class ApiService {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        credentials: 'include',
        ...options,
      });

      if (!response.ok) {
        // Try to parse error message from response
        let errorMessage = 'Server error';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // If parsing fails, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      // Only try to parse JSON if we have content
      const text = await response.text();
      if (text) {
        try {
          const data = JSON.parse(text);
          return { success: true, data };
        } catch (err) {
          console.error('Failed to parse JSON response:', err);
          throw new Error('Invalid JSON response');
        }
      }

      return { success: true, data: {} as T };
    } catch (error) {
      console.error('API Request failed:', error);
      return {
        success: false,
        data: {} as T,
        message: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  async checkHealth() {
    return this.request<{ status: string }>('/api/health');
  }

  async getAuthUrl() {
    return this.request<{ authUrl: string }>('/api/auth-url');
  }

  async sendChatMessage(message: string): Promise<{ reply?: string; followUpQuestion?: string; needsMoreInfo?: boolean }> {
    type ChatResponse = { 
      success: boolean;
      reply?: string; 
      followUpQuestion?: string; 
      needsMoreInfo?: boolean;
      message?: string;
      summary?: string;
    };
    
    const response = await this.request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });

    if (!response.success) {
      throw new Error(response.message || 'Request failed');
    }

    return {
      reply: response.data.reply || response.data.summary,
      followUpQuestion: response.data.followUpQuestion,
      needsMoreInfo: response.data.needsMoreInfo
    };
  }

  async startPipeline(meetingData: any) {
    return this.request<{ pipelineId: string }>('/api/start-pipeline', {
      method: 'POST',
      body: JSON.stringify(meetingData),
    });
  }
}

export const apiService = new ApiService();