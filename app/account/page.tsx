import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import AccountSettings from "@/components/AccountSettings";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  return (
    <>
      <Nav isAdmin={profile?.role === "admin"} />
      <AccountSettings />
    </>
  );
}
