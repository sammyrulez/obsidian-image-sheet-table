// types
export type AuthMethod = "public-csv" | "oauth-desktop";

export interface AuthSettings {
  authMethod: AuthMethod;
  clientId: string;           // OAuth Desktop / Web client ID
  clientSecret: string;      
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;       // epoch ms
}

export interface PluginSettings {
  auth: AuthSettings;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  auth: {
    authMethod: "public-csv",
    clientId: "",
    clientSecret: "",
  },
};
