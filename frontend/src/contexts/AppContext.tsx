import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, Meeting, ChatMessage } from '../types';

type AppAction =
  | { type: 'SET_MEETINGS'; payload: Meeting[] }
  | { type: 'ADD_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_AUTH_STATUS'; payload: boolean }
  | { type: 'SET_AUTH_URL'; payload: string }
  | { type: 'SET_MODE'; payload: AppState['currentMode'] }
  | { type: 'UPDATE_MEETING'; payload: Meeting };

const initialState: AppState = {
  meetings: [],
  chatMessages: [],
  isAuthenticated: false,
  currentMode: 'landing',
};

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