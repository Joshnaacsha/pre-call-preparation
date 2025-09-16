import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import DatabaseService from './database.js';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiryDate: Date;
}

export class TokenService {
  private static instance: TokenService;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private tenantId: string;

  private constructor() {
    this.clientId = process.env.MS_CLIENT_ID || '';
    this.clientSecret = process.env.MS_CLIENT_SECRET || '';
    this.redirectUri = process.env.MS_REDIRECT_URI || '';
    this.tenantId = process.env.MS_TENANT_ID || '';

    if (!this.clientId || !this.clientSecret || !this.redirectUri || !this.tenantId) {
      throw new Error('Missing required environment variables for Microsoft Graph authentication');
    }
  }

  static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService();
    }
    return TokenService.instance;
  }

  async exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    const tokenEndpoint = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: code,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code'
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json() as TokenResponse;
    return data;
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const tokenEndpoint = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'offline_access https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read'
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json() as TokenResponse;
    return data;
  }

  async refreshTokenIfNeeded(email: string): Promise<TokenInfo> {
    const db = await DatabaseService;
    const subscription = await db.getUserSubscription(email);
    
    if (!subscription) {
      throw new Error('No subscription found for user');
    }

    // Check if token is expired or will expire in the next 5 minutes
    const now = new Date();
    const expiryDate = new Date(subscription.token_expiry);
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiryDate <= fiveMinutesFromNow) {
      console.log('Token expired or expiring soon, refreshing...');
      const newTokens = await this.refreshAccessToken(subscription.refresh_token);
      
      // Calculate new expiry date
      const newExpiryDate = new Date(now.getTime() + newTokens.expires_in * 1000);
      
      // Update the database with new tokens
      await db.updateAccessToken(
        email,
        newTokens.access_token,
        newExpiryDate
      );

      return {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        expiryDate: newExpiryDate
      };
    }

    return {
      accessToken: subscription.access_token,
      refreshToken: subscription.refresh_token,
      expiryDate: expiryDate
    };
  }

  async getUserInfo(accessToken: string): Promise<{ email: string }> {
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    const data = await response.json() as { userPrincipalName?: string; mail?: string };
    const email = data.userPrincipalName || data.mail;
    if (!email) {
      throw new Error('No email found in user info');
    }
    return { email };
  }
}

export default TokenService.getInstance();