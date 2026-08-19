import { DealWorkspace } from "@/components/DealWorkspace";
export default function Repay({ params }: { params: { id: string } }) { return <DealWorkspace id={params.id} screen="repay" />; }
