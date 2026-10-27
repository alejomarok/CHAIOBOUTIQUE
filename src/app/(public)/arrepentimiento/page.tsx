import { PolicyPage } from "@/components/legal/policy-page";
export const metadata = {
  title: "Botón de arrepentimiento",
  robots: { index: false, follow: true },
};
export default function Page() {
  return <PolicyPage policy="withdrawal" />;
}
