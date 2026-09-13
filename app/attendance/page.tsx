import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import AttendanceWidget from "@/components/AttendanceWidget";

export default async function AttendancePage() {
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
      <AttendanceWidget />
    </>
  );
}
