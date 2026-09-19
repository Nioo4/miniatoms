import Workbench from "@/components/workbench";
import { uuidSchema } from "@/lib/contracts";
import { notFound } from "next/navigation";
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();
  return <Workbench key={parsed.data} projectId={parsed.data} />;
}
