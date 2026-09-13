import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import AttendanceAdminPanel from "@/components/AttendanceAdminPanel";

export default async function AdminAttendancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/dial");

  return (
    <>
      <Nav isAdmin={true} />
      <AttendanceAdminPanel />
    </>
  );
}
