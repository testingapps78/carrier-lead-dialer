import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import TeamFeed from "@/components/TeamFeed";

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = profile?.role === "admin";

  return (
    <>
      <Nav isAdmin={isAdmin} />
      <TeamFeed isAdmin={isAdmin} userId={user.id} />
    </>
  );
}
