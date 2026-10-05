import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Investment Pool | Evaluation Round",
  description: "A clear and fair investment simulation for event teams.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
