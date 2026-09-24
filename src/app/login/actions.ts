"use server";

import { redirect } from "next/navigation";

import { performLogin, type LoginState } from "@/lib/auth/login";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const supabase = await createClient();

  const result = await performLogin(formData, {
    async isEmailAllowed(email) {
      const { data, error } = await createAdminClient().rpc("is_email_allowed", { email });
      if (error) throw error;
      return data === true;
    },
    async signInWithPassword(email, password) {
      return supabase.auth.signInWithPassword({ email, password });
    },
  });

  if (!result.ok) return result.state;
  redirect(result.redirectTo);
}
