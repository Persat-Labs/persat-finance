import { DealWorkspace } from "@/components/DealWorkspace";
export default function Manage({ params }: { params: { id: string } }) { return <DealWorkspace id={params.id} screen="manage" />; }
