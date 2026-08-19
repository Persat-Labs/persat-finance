import { AppFrame } from "@/components/AppFrame";
import { Card } from "@/lib/design-system";
export default function Admin() { return <AppFrame eyebrow="Governance signer gated" title="Protocol administration"><Card className="mt-8"><p className="eyebrow">Access restricted</p><p className="mt-3 text-orange-50">This surface will require a connected governance signer and on-chain governance authorization. It will not use an email/password administrator for protocol controls.</p></Card></AppFrame>; }
