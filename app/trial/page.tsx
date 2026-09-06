import TrialDial from "@/components/TrialDial";

export const metadata = {
  title: "Carrier Dialer — Free Trial",
  description: "Try live FMCSA carrier lookup free — no account needed.",
};

export default function TrialPage() {
  return (
    <div className="min-h-screen">
      <TrialDial />
    </div>
  );
}
