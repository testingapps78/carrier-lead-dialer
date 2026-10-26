/* eslint-disable @next/next/no-img-element */
// Imported (not referenced by /public path) so the files are emitted as static assets under /_next/static,
// which signed-out visitors can load; plain /public files are redirected to /login by the middleware.
import markDark from "@/public/logo-mark.png";
import markLight from "@/public/logo-mark-light.png";
import lockupDark from "@/public/logo-lockup.png";
import lockupLight from "@/public/logo-lockup-light.png";

// Two images, one per theme; CSS (globals.css) shows the one with good contrast. No script, so no flash.
export default function Logo({ variant = "mark", className = "" }: { variant?: "mark" | "lockup"; className?: string }) {
  const dark = variant === "mark" ? markDark : lockupDark;
  const light = variant === "mark" ? markLight : lockupLight;
  const alt = variant === "mark" ? "" : "Carrier Dialer";
  return (
    <>
      <img src={dark.src} width={dark.width} height={dark.height} alt={alt} className={`logo-on-dark ${className}`} />
      <img src={light.src} width={light.width} height={light.height} alt={alt} className={`logo-on-light ${className}`} />
    </>
  );
}
