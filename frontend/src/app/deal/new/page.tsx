import { AppFrame } from "@/components/AppFrame";
import { TermsForm } from "@/components/TermsForm";
export default function NewDeal() { return <AppFrame eyebrow="Direct path // Screen A1" title="Create a private deal"><p className="mt-4 max-w-2xl text-orange-50">Set the exact terms you agreed elsewhere. If you do not know the counterparty wallet, the secure backend will issue a single-use link after the on-chain deal exists.</p><TermsForm mode="private" /></AppFrame>; }
