import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, Meeting, ChatMessage } from '../types';

type AppAction =
  | { type: 'SET_MEETINGS'; payload: Meeting[] }
  | { type: 'ADD_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_AUTH_STATUS'; payload: boolean }
  | { type: 'SET_AUTH_URL'; payload: string }
  | { type: 'SET_MODE'; payload: AppState['currentMode'] }
  | { type: 'UPDATE_MEETING'; payload: Meeting };

// Load initial state from localStorage
const loadInitialState = (): AppState => {
  const savedState = localStorage.getItem('appState');
  const savedAuth = localStorage.getItem('authState');
  
  const defaultState: AppState = {
    meetings: [],
    chatMessages: [],
    isAuthenticated: false,
    currentMode: 'landing',
    lastAuthStatus: null,
    pipelineStatus: 'idle',
  };

  // First check if we have valid authentication
  let isAuthenticated = false;
  if (savedAuth) {
    try {
      const parsedAuth = JSON.parse(savedAuth);
      isAuthenticated = Boolean(parsedAuth.isAuthenticated);
    } catch (e) {
      console.error('Failed to parse auth state:', e);
    }
  }

  // Then load the rest of the state
  if (savedState) {
    try {
      const parsedState = JSON.parse(savedState);
      return {
        ...defaultState,
        ...parsedState,
        isAuthenticated, // Use the auth status we just verified
        pipelineStatus: isAuthenticated ? 'completed' : 'idle',
        lastAuthStatus: isAuthenticated ? new Date().toISOString() : null,
      };
    } catch (e) {
      console.error('Failed to parse app state:', e);
    }
  }

  return {
    ...defaultState,
    isAuthenticated, // Maintain auth status even if app state fails to load
  };
};

const initialState = loadInitialState();

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_MEETINGS':
      return { ...state, meetings: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, chatMessages: [...state.chatMessages, action.payload] };
    case 'SET_AUTH_STATUS':
      return { ...state, isAuthenticated: action.payload };
    case 'SET_AUTH_URL':
      return { ...state, authUrl: action.payload };
    case 'SET_MODE':
      return { ...state, currentMode: action.payload };
    case 'UPDATE_MEETING':
      return {
        ...state,
        meetings: state.meetings.map(m => 
          m.id === action.payload.id ? action.payload : m
        ),
      };
    default:
      return state;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Save state to localStorage whenever it changes
  React.useEffect(() => {
    // Save both auth and app state
    localStorage.setItem('appState', JSON.stringify({
      isAuthenticated: state.isAuthenticated,
      currentMode: state.currentMode,
    }));
    
    // Also update authState for consistency
    if (state.isAuthenticated) {
      localStorage.setItem('authState', JSON.stringify({
        isAuthenticated: true,
        pipelineStatus: state.pipelineStatus || 'completed'
      }));
    } else {
      localStorage.removeItem('authState');
    }
  }, [state.isAuthenticated, state.currentMode, state.pipelineStatus]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
}