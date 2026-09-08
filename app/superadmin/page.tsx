import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import SuperAdminPanel from "@/components/SuperAdminPanel";

export default async function SuperAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, is_super_admin").eq("id", user.id).single();
  if (!profile?.is_super_admin) redirect("/dial");

  return (
    <>
      <Nav isAdmin={profile.role === "admin"} />
      <SuperAdminPanel />
    </>
  );
}
