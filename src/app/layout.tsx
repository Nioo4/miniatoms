import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "MiniAtoms · 让想法成为应用", description: "通过自然语言构建、预览和迭代你的应用。" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
