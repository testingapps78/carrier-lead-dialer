/* eslint-disable @next/next/no-img-element */
// Two images, one per theme; CSS (globals.css) shows the one with good contrast. No script, so no flash.
export default function Logo({ variant = "mark", className = "" }: { variant?: "mark" | "lockup"; className?: string }) {
  const dark = variant === "mark" ? "/logo-mark.png" : "/logo-lockup.png";
  const light = variant === "mark" ? "/logo-mark-light.png" : "/logo-lockup-light.png";
  const alt = variant === "mark" ? "" : "Carrier Dialer";
  return (
    <>
      <img src={dark} alt={alt} className={`logo-on-dark ${className}`} />
      <img src={light} alt={alt} className={`logo-on-light ${className}`} />
    </>
  );
}
