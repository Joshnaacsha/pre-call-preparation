import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface UserSubscription {
  id: number;
  email: string;
  access_token: string;
  refresh_token: string;
  token_expiry: Date;
  created_at: Date;
  updated_at: Date;
}

export class DatabaseService {
  private static instance: DatabaseService;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async createUserSubscription(
    email: string,
    accessToken: string,
    refreshToken: string,
    tokenExpiry: Date
  ): Promise<UserSubscription> {
    // Input validation
    if (!email || typeof email !== 'string') {
      throw new Error('Invalid email provided');
    }
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Invalid access token provided');
    }
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new Error('Invalid refresh token provided');
    }
    if (!tokenExpiry || !(tokenExpiry instanceof Date)) {
      throw new Error('Invalid token expiry provided');
    }

    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .upsert({
          email: email.trim().toLowerCase(),
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expiry: tokenExpiry.toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'email'
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to create or update user subscription');

      return {
        ...data,
        token_expiry: new Date(data.token_expiry),
        created_at: new Date(data.created_at),
        updated_at: new Date(data.updated_at)
      };
    } catch (error) {
      console.error('Database error in createUserSubscription:', error);
      throw error instanceof Error 
        ? error 
        : new Error('Failed to create user subscription');
    }
  }

  async getUserSubscription(email: string): Promise<UserSubscription | null> {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select()
      .eq('email', email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows found
      throw error;
    }

    return data ? {
      ...data,
      token_expiry: new Date(data.token_expiry),
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at)
    } : null;
  }

  async getAllActiveSubscriptions(): Promise<UserSubscription[]> {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select()
      .gt('token_expiry', new Date().toISOString());

    if (error) throw error;
    
    return data.map(row => ({
      ...row,
      token_expiry: new Date(row.token_expiry),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    }));
  }

  async updateAccessToken(
    email: string,
    accessToken: string,
    tokenExpiry: Date
  ): Promise<void> {
    const { error } = await supabase
      .from('user_subscriptions')
      .update({
        access_token: accessToken,
        token_expiry: tokenExpiry.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('email', email);

    if (error) throw error;
  }

  async deleteUserSubscription(email: string): Promise<void> {
    const { error } = await supabase
      .from('user_subscriptions')
      .delete()
      .eq('email', email);

    if (error) throw error;
  }
}

export default DatabaseService.getInstance();