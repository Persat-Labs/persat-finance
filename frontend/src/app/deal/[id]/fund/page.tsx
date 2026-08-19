import { DealWorkspace } from "@/components/DealWorkspace";
export default function Fund({ params }: { params: { id: string } }) { return <DealWorkspace id={params.id} screen="fund" />; }
