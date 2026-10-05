import { redirect } from "next/navigation";

/** Systém začíná na dnešním přehledu obchodníka. */
export default function Home() {
  redirect("/dashboard");
}
