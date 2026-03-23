import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wujlbozlfitgxpytnhnk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1amxib3psZml0Z3hweXRuaG5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODg0NDAsImV4cCI6MjA4ODU2NDQ0MH0.QlrKDocLsqPDmInvSrIXc4YDzHhdE3soey7nAaulAz4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface WiseshiftResponse {
  id?: string;
  wise_name: string;
  country: string;
  answers: Record<string, any>;
  meta: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

/**
 * Save or update a questionnaire response in the cloud.
 * If cloudId is provided, updates the existing record. Otherwise creates a new one.
 * Returns the record ID.
 */
export async function cloudSave(
  cloudId: string | null,
  wiseName: string,
  country: string,
  answers: Record<string, any>
): Promise<{ id: string; error: string | null }> {
  const meta = {
    lastSaved: new Date().toISOString(),
    wiseName,
    country
  };

  try {
    if (cloudId) {
      // Update existing
      const { data, error } = await supabase
        .from('wiseshift_responses')
        .update({ wise_name: wiseName, country, answers, meta })
        .eq('id', cloudId)
        .select('id')
        .single();

      if (error) return { id: cloudId, error: error.message };
      return { id: data.id, error: null };
    } else {
      // Insert new
      const { data, error } = await supabase
        .from('wiseshift_responses')
        .insert({ wise_name: wiseName, country, answers, meta })
        .select('id')
        .single();

      if (error) return { id: '', error: error.message };
      return { id: data.id, error: null };
    }
  } catch (e: any) {
    return { id: cloudId || '', error: e.message || 'Unknown error' };
  }
}

/**
 * Load a questionnaire response from the cloud by ID.
 */
export async function cloudLoad(cloudId: string): Promise<{ data: WiseshiftResponse | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('wiseshift_responses')
      .select('*')
      .eq('id', cloudId)
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as WiseshiftResponse, error: null };
  } catch (e: any) {
    return { data: null, error: e.message || 'Unknown error' };
  }
}

/**
 * List all saved questionnaire responses (for a "load from cloud" picker).
 */
export async function cloudList(): Promise<{ data: WiseshiftResponse[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('wiseshift_responses')
      .select('id, wise_name, country, meta, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as WiseshiftResponse[], error: null };
  } catch (e: any) {
    return { data: [], error: e.message || 'Unknown error' };
  }
}
