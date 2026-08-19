import { AppFrame } from "@/components/AppFrame";
import { TermsForm } from "@/components/TermsForm";
export default function NewListing() { return <AppFrame eyebrow="Marketplace // Screen B2" title="Post a structured listing"><p className="mt-4 max-w-2xl text-orange-50">Marketplace listings expose only comparable terms: amount, currency, duration, rate, and collateral. Free-text descriptions and messages are intentionally excluded.</p><TermsForm mode="public" /></AppFrame>; }
