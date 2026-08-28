import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import DialTool from "@/components/DialTool";

export default async function DialPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    isAdmin = profile?.role === "admin";
  }

  return (
    <>
      <Nav isAdmin={isAdmin} />
      <DialTool />
    </>
  );
}
