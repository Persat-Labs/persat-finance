import { DealWorkspace } from "@/components/DealWorkspace";
export default function Confirm({ params }: { params: { id: string } }) { return <DealWorkspace id={params.id} screen="confirm" />; }
