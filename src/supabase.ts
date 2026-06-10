import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logDev, logDevGroup } from "./core.utils";

interface SupabaseConfig {
  main: {
    url: string;
    anonKey: string;
  };
  auth: {
    url: string;
    anonKey: string;
  } | null;
}

export interface SupabaseInitializerParams {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseNeedAuthUrl?: string;
  supabaseNeedAuthAnonKey?: string;
}

export class SupabaseInitializer {
  private static instance: SupabaseInitializer;
  private isInitialized = false;
  private _mainClient: SupabaseClient | null = null;
  private _authClient: SupabaseClient | null = null;

  private constructor() {}

  static getInstance(): SupabaseInitializer {
    if (!SupabaseInitializer.instance) {
      SupabaseInitializer.instance = new SupabaseInitializer();
    }
    return SupabaseInitializer.instance;
  }

  /**
   * Initialize Supabase clients
   */
  async initialize(
    params: SupabaseInitializerParams
  ): Promise<{ supabase: SupabaseClient; supabaseAuth: SupabaseClient | null }> {
    if (this.isInitialized) {
      logDev("🚫 Supabase already initialized");
      return { supabase: this._mainClient!, supabaseAuth: this._authClient };
    }

    logDev("🔧 Initializing Supabase...");

    // Validate and get environment variables
    const config = this.validateEnvironmentVariables(params);

    // Create main client
    this._mainClient = createClient(config.main.url, config.main.anonKey, {
      // TODO
      // auth: {
      //   persistSession: true,
      //   autoRefreshToken: true,
      // },
    });

    // Create auth client if configured
    if (config.auth) {
      this._authClient = createClient(config.auth.url, config.auth.anonKey, {
        // TODO
        // auth: {
        //   persistSession: true,
        //   autoRefreshToken: true,
        // },
      });
    }

    // Log configuration
    this.logConfiguration(config);

    this.isInitialized = true;
    logDev("✅ Supabase initialization completed");

    return { supabase: this._mainClient, supabaseAuth: this._authClient };
  }

  private validateEnvironmentVariables({
    supabaseUrl,
    supabaseAnonKey,
    supabaseNeedAuthUrl,
    supabaseNeedAuthAnonKey,
  }: SupabaseInitializerParams): SupabaseConfig {
    const mainUrl = supabaseUrl;
    const mainAnonKey = supabaseAnonKey;
    const authUrl = supabaseNeedAuthUrl;
    const authAnonKey = supabaseNeedAuthAnonKey;

    if (!mainUrl || !mainAnonKey) {
      throw new Error("Missing required Supabase environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY");
    }

    return {
      main: { url: mainUrl, anonKey: mainAnonKey },
      auth: authUrl && authAnonKey ? { url: authUrl, anonKey: authAnonKey } : null,
    };
  }

  private logConfiguration(config: SupabaseConfig) {
    logDevGroup("🔧 Supabase Configuration", () => {
      console.log("Main URL:", config.main.url);
      console.log("Auth URL:", config.auth?.url || "Not configured");
      console.log("Clients:", {
        main: !!this._mainClient,
        auth: !!this._authClient,
      });
    });
  }

  getClients() {
    if (!this.isInitialized) {
      throw new Error("Supabase not initialized. Call initialize() first.");
    }
    return { supabase: this._mainClient!, supabaseAuth: this._authClient };
  }

  get client(): SupabaseClient {
    if (!this.isInitialized) {
      throw new Error("Supabase not initialized. Call initialize() first.");
    }
    if (!this._mainClient) {
      throw new Error("Main Supabase client is null. Initialization may have failed.");
    }
    return this._mainClient;
  }

  get authClient(): SupabaseClient | null {
    if (!this.isInitialized) {
      throw new Error("Supabase not initialized. Call initialize() first.");
    }
    return this._authClient;
  }

  reset() {
    this.isInitialized = false;
    this._mainClient = null;
    this._authClient = null;
  }
}
